#!/usr/bin/env python3
"""Persistent OpenOCR worker (JSON lines on stdin/stdout).

Mobile pipeline, matching Topdu/OpenOCR:
  Detector: RepViT DB
  Recognizer: RepSVTR Mobile
  Backend: ONNX
  Device: CPU  (mode=mobile, backend=onnx, use_gpu=false)

The process stays alive so ONNX sessions are not reloaded per photo.
"""

from __future__ import annotations

import json
import os
import re
import sys
import tempfile
import traceback
from itertools import permutations

ENGINE = 'openocr'

# OpenOCR sometimes emits CJK lookalikes for a painted Latin I.
_GLYPH_MAP = str.maketrans({
    '一': 'I',
    '丨': 'I',
    '│': 'I',
    '｜': 'I',
})


def _version() -> str:
    try:
        import importlib.metadata
        return importlib.metadata.version('openocr-python')
    except Exception:
        return '0.1.5'


def _boot():
    from openocr import OpenOCR

    det = os.environ.get('OPENOCR_DET_MODEL') or None
    rec = os.environ.get('OPENOCR_REC_MODEL') or None
    auto = not (det and rec)
    return OpenOCR(
        task='ocr',
        mode='mobile',
        backend='onnx',
        use_gpu='false',
        onnx_det_model_path=det,
        onnx_rec_model_path=rec,
        auto_download=auto,
        drop_score=0.3,
    )


def _as_list(value):
    if value is None:
        return []
    if isinstance(value, list):
        return value
    return [value]


def _extract_lines(results) -> list[dict]:
    lines: list[dict] = []

    def push(text, score=0.0, box=None):
        cleaned = str(text or '').strip().translate(_GLYPH_MAP)
        if not cleaned:
            return
        try:
            numeric = float(score)
        except (TypeError, ValueError):
            numeric = 0.0
        lines.append({'text': cleaned, 'score': numeric, 'box': box})

    for item in _as_list(results):
        if isinstance(item, str):
            payload = item.split('\t', 1)[-1] if '\t' in item else item
            try:
                recs = json.loads(payload)
            except Exception:
                push(payload, 1.0)
                continue
            lines.extend(_extract_lines(recs))
            continue

        if isinstance(item, dict):
            text = item.get('transcription') or item.get('text') or ''
            score = item.get('score', 0.0)
            box = item.get('points') or item.get('box')
            if text:
                push(text, score, box)
            elif 'ocr_result' in item:
                lines.extend(_extract_lines(item.get('ocr_result')))
            continue

        if isinstance(item, (list, tuple)):
            if len(item) >= 2 and isinstance(item[1], (list, tuple)):
                # Common Paddle-style (box, (text, score))
                box, rec = item[0], item[1]
                if isinstance(rec, (list, tuple)) and rec:
                    push(rec[0], rec[1] if len(rec) > 1 else 0.0, box)
                else:
                    lines.extend(_extract_lines(item))
            else:
                lines.extend(_extract_lines(item))

    return lines


def _compact_text(text: str) -> str:
    compact = re.sub(r'[^A-Z0-9]', '', str(text or '').upper())
    # CJK lookalikes plus a Latin I collapse to one I (the thin door-code glyph).
    if re.fullmatch(r'I{2,3}', compact):
        return 'I'
    return compact


def _compact(lines: list[dict]) -> str:
    return ''.join(_compact_text(line.get('text', '')) for line in lines)


def _line_has_container(text: str) -> bool:
    """True when one transcript already looks like ISO 6346 (or I/1 in the owner)."""
    compact = _compact_text(text)
    if re.search(r'[A-Z]{4}\d{7}', compact):
        return True
    if re.fullmatch(r'[A-Z]{3}U\d{6}', compact):
        return True
    return bool(re.fullmatch(r'[A-Z0-9]{4}\d{7}', compact) and re.search(r'[A-Z]', compact[:4]))


def _has_container(lines: list[dict]) -> bool:
    return any(_line_has_container(line.get('text') or '') for line in lines)


def _merge_lines(*groups: list[dict]) -> list[dict]:
    merged: list[dict] = []
    seen: set[str] = set()
    for group in groups:
        for line in group:
            key = re.sub(r'[^A-Z0-9]', '', str(line.get('text') or '').upper())
            if not key or key in seen:
                continue
            seen.add(key)
            merged.append(line)
    return merged


def _box_center(box):
    """Return ((cx, cy), short_side) for a Paddle-style quad or x,y,w,h box."""
    if not box:
        return None
    try:
        if isinstance(box, (list, tuple)) and len(box) >= 4:
            if all(isinstance(v, (int, float)) for v in box[:4]) and not isinstance(box[0], (list, tuple)):
                x, y, w, h = (float(box[0]), float(box[1]), float(box[2]), float(box[3]))
                return (x + w / 2.0, y + h / 2.0), min(abs(w), abs(h)) or 8.0
            xs = []
            ys = []
            for point in box:
                if isinstance(point, (list, tuple)) and len(point) >= 2:
                    xs.append(float(point[0]))
                    ys.append(float(point[1]))
            if len(xs) >= 2:
                width = max(xs) - min(xs)
                height = max(ys) - min(ys)
                return ((min(xs) + max(xs)) / 2.0, (min(ys) + max(ys)) / 2.0), min(width, height) or 8.0
    except (TypeError, ValueError, IndexError):
        return None
    return None


def _column_stitches(lines: list[dict]) -> list[dict]:
    """Join glyphs that sit in a vertical column (stacked door codes)."""
    placed = []
    for line in lines:
        text = str(line.get('text') or '').strip()
        geo = _box_center(line.get('box'))
        if not text or not geo:
            continue
        (cx, cy), short = geo
        placed.append((cx, cy, short, text, line.get('score', 0.0)))
    if len(placed) < 2:
        return []

    gap = max(12.0, sorted(item[2] for item in placed)[len(placed) // 2] * 1.8)
    columns: list[list[tuple]] = []
    for item in sorted(placed, key=lambda row: row[0]):
        if not columns or abs(item[0] - columns[-1][-1][0]) > gap:
            columns.append([item])
        else:
            columns[-1].append(item)

    extra: list[dict] = []
    for column in columns:
        if len(column) < 2:
            continue
        column.sort(key=lambda row: row[1])
        runs: list[list[tuple]] = []
        current: list[tuple] = []
        for item in column:
            if current:
                gap = item[1] - current[-1][1]
                limit = max(36.0, current[-1][2] * 3.2)
                if gap > limit:
                    runs.append(current)
                    current = []
            current.append(item)
        if current:
            runs.append(current)

        for run in runs:
            if len(run) < 2:
                continue
            joined = ''.join(row[3] for row in run)
            compact = _compact_text(joined)
            if len(compact) < 4:
                continue
            score = sum(float(row[4] or 0) for row in run) / len(run)
            extra.append({'text': joined, 'score': score, 'box': None})
    return extra


# Bumper stickers and warning labels that must not become ISO owner codes.
_LABEL_DENY = {
    'ONLY', 'LED', 'HEAV', 'UPER', 'SUPER', 'HEAVY', 'POOL', 'METRO',
    'DORSEY', 'TROPICAL', 'CAUTION', 'HIGH', 'WARNING', 'NOTICE',
    'AMAZON', 'METROPOOL', 'OUTOOOOA', 'CHINA',
}


def _owner_candidates(frags: list[str]) -> list[str]:
    """Build 4-letter category-U prefixes from short stacked glyphs."""
    unique: list[str] = []
    seen: set[str] = set()
    for frag in frags:
        if not frag or frag in _LABEL_DENY or frag in seen:
            continue
        if not re.fullmatch(r'[A-Z]{1,4}', frag):
            continue
        seen.add(frag)
        unique.append(frag)

    owners: set[str] = set()
    for frag in unique:
        if re.fullmatch(r'[A-Z]{3}U', frag):
            owners.add(frag)

    subset = unique[:8]
    for count in (2, 3):
        for parts in permutations(subset, count):
            joined = ''.join(parts)
            if re.fullmatch(r'[A-Z]{3}U', joined):
                owners.add(joined)

    has_i = any(frag == 'I' or (len(frag) <= 2 and 'I' in frag) for frag in unique)
    has_u = any(frag == 'U' or frag.endswith('U') for frag in unique)
    if has_u and not has_i:
        for frag in unique:
            if re.fullmatch(r'[A-Z]{2}', frag) and frag[1] != 'U':
                owners.add(f'{frag}IU')

    two_letter = [frag for frag in unique if len(frag) == 2 and frag[1] != 'U']
    if two_letter:
        owners = {owner for owner in owners if any(owner.startswith(prefix) for prefix in two_letter)}
    return list(owners)


def _assemble_iso_from_lines(lines: list[dict]) -> list[dict]:
    """Join stacked door-code glyphs without using the chassis plate serial."""
    tokens = [_compact_text(line.get('text') or '') for line in lines]
    tokens = [token for token in tokens if token]

    chassis_serials: set[str] = set()
    chassis_owners: set[str] = set()
    for token in tokens:
        if re.fullmatch(r'[A-Z]{4}\d{6}', token):
            chassis_owners.add(token[:4])
            chassis_serials.add(token[4:])

    letter_frags: list[str] = []
    serials: list[str] = []
    extra: list[dict] = []

    def add_letter(value: str) -> None:
        if value and value not in letter_frags and value not in chassis_owners and value not in _LABEL_DENY:
            letter_frags.append(value)

    def add_serial(value: str) -> None:
        if not value or not value.isdigit() or len(value) not in (6, 7):
            return
        if value in chassis_serials or value[-6:] in chassis_serials:
            return
        if value not in serials:
            serials.append(value)

    for token in tokens:
        if token in _LABEL_DENY or token in chassis_owners:
            continue
        if re.fullmatch(r'[A-Z]{3}[UJZ]\d{7}', token) or re.fullmatch(r'[A-Z0-9]{4}\d{7}', token):
            extra.append({'text': token, 'score': 0.6, 'box': None})
            continue
        match = re.fullmatch(r'([A-Z]{1,3}U)(\d{6,7})', token)
        if match:
            add_letter(match.group(1))
            add_serial(match.group(2))
            continue
        if re.fullmatch(r'U\d{6,7}', token):
            add_letter('U')
            add_serial(token[1:])
            continue
        if re.fullmatch(r'\d{6,7}', token):
            add_serial(token)
            continue
        if re.fullmatch(r'[A-Z]{1,4}', token):
            add_letter(token)

    for owner in _owner_candidates(letter_frags):
        for serial in serials:
            extra.append({'text': owner + serial, 'score': 0.62, 'box': None})
    return extra


def _letter_digit_joins(lines: list[dict]) -> list[dict]:
    """Join stacked owner letters with a 6–7 digit serial from the same view."""
    return _assemble_iso_from_lines(lines)


def _workdir() -> str:
    root = os.environ.get('OPENOCR_WORKDIR') or os.path.join(tempfile.gettempdir(), 'openocr')
    os.makedirs(root, exist_ok=True)
    return root


def _save_dir() -> str:
    path = os.path.join(_workdir(), 'e2e_results')
    os.makedirs(path, exist_ok=True)
    return path


def _upscale(img, factor: float):
    import cv2
    if factor <= 1:
        return img
    height, width = img.shape[:2]
    return cv2.resize(
        img,
        (max(1, int(width * factor)), max(1, int(height * factor))),
        interpolation=cv2.INTER_CUBIC,
    )


def _door_code_views(img) -> list:
    """Crops where stacked upright ISO door codes usually sit.

    Door codes are upright glyphs in a column on a corrugation rib — rotating
    the whole photo makes those letters sideways. Tight, upscaled upper-right
    (and overlapping) windows let the detector see them.
    """
    import cv2

    height, width = img.shape[:2]
    views = []
    windows = (
        (0.00, 0.55, 0.50, 1.00, 2.0),
        (0.00, 0.50, 0.45, 0.75, 3.0),
        (0.00, 0.50, 0.50, 0.80, 3.0),
        (0.00, 0.45, 0.48, 0.72, 3.0),
        (0.05, 0.50, 0.58, 0.78, 4.0),
    )
    for y0, y1, x0, x1, scale in windows:
        tile = img[int(height * y0):int(height * y1), int(width * x0):int(width * x1)]
        if tile.size == 0 or min(tile.shape[:2]) < 24:
            continue
        views.append(cv2.resize(
            tile,
            (max(1, int(tile.shape[1] * scale)), max(1, int(tile.shape[0] * scale))),
            interpolation=cv2.INTER_CUBIC,
        ))
    return views


def _rib_view(img, lines: list[dict]):
    """If the first pass already found a column of short glyphs, zoom that rib."""
    import cv2

    placed = []
    for line in lines:
        text = _compact_text(line.get('text') or '')
        geo = _box_center(line.get('box'))
        if not text or len(text) > 4 or not geo:
            continue
        (cx, cy), short = geo
        placed.append((cx, cy, short))
    if len(placed) < 4:
        return None

    gap = max(14.0, sorted(item[2] for item in placed)[len(placed) // 2] * 1.8)
    columns: list[list[tuple]] = []
    for item in sorted(placed, key=lambda row: row[0]):
        if not columns or abs(item[0] - columns[-1][-1][0]) > gap:
            columns.append([item])
        else:
            columns[-1].append(item)
    column = max(columns, key=len)
    if len(column) < 4:
        return None

    xs = [row[0] for row in column]
    ys = [row[1] for row in column]
    shorts = [row[2] for row in column]
    pad = max(18.0, (sum(shorts) / len(shorts)) * 2.2)
    height, width = img.shape[:2]
    x0 = max(0, int(min(xs) - pad))
    x1 = min(width, int(max(xs) + pad))
    y0 = max(0, int(min(ys) - pad * 2))
    y1 = min(height, int(max(ys) + pad * 3))
    rib = img[y0:y1, x0:x1]
    if min(rib.shape[:2]) < 20:
        return None
    return cv2.resize(
        rib,
        (max(1, rib.shape[1] * 4), max(1, rib.shape[0] * 4)),
        interpolation=cv2.INTER_CUBIC,
    )


def _parse_ocr_output(out):
    if isinstance(out, tuple):
        results = out[0] if out else None
        timing = out[1] if len(out) > 1 else None
    else:
        results, timing = out, None
    return _extract_lines(results), timing


def _run_numpy(ocr, img):
    save_dir = _save_dir()
    out = ocr(img_numpy=img, save_dir=save_dir, is_visualize=False)
    return _parse_ocr_output(out)


def _run(ocr, image_path: str):
    # OpenOCR defaults save_dir='e2e_results/' in the process cwd (/app), which
    # the non-root app user cannot create. Prefer in-memory numpy so nothing is
    # written; if we must use a path, point save_dir at a writable temp folder.
    save_dir = _save_dir()
    img = None
    try:
        import cv2
        img = cv2.imread(image_path)
    except Exception:
        img = None

    if img is None:
        out = ocr(image_path=image_path, save_dir=save_dir, is_visualize=False)
        return _parse_ocr_output(out)

    lines, timing = _run_numpy(ocr, img)
    return _orientation_pass(ocr, img, lines, timing)


def _orientation_pass(ocr, img, lines: list[dict], timing):
    """Add door-code crops for stacked upright ISO markings.

    Chassis plates are horizontal. Container numbers on the rear doors are
    upright letters stacked down a rib. A 90° rotation of the whole photo
    makes those letters sideways and is the wrong transform. Zoomed
    upper-right windows (and a tight rib crop when glyphs were already
    found) are the right one.
    """
    combined = _merge_lines(lines, _column_stitches(lines), _letter_digit_joins(lines))
    combined = _merge_lines(combined, _assemble_iso_from_lines(combined))
    if _has_container(combined):
        return combined, timing

    views = []
    rib = _rib_view(img, lines)
    if rib is not None:
        views.append(rib)
    views.extend(_door_code_views(img))

    best_timing = timing
    for view in views:
        try:
            extra, extra_timing = _run_numpy(ocr, view)
            extra = _merge_lines(extra, _column_stitches(extra), _letter_digit_joins(extra))
            combined = _merge_lines(combined, extra)
            combined = _merge_lines(combined, _assemble_iso_from_lines(combined))
            if extra_timing:
                best_timing = extra_timing
            if _has_container(combined):
                return combined, best_timing
        except Exception:
            continue
    combined = _merge_lines(combined, _assemble_iso_from_lines(combined))
    return combined, best_timing


def _reply(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + '\n')
    sys.stdout.flush()


def main() -> int:
    try:
        os.chdir(_workdir())
    except OSError:
        pass
    ocr = _boot()
    _reply({
        'ok': True,
        'event': 'ready',
        'engine': ENGINE,
        'engineVersion': _version(),
    })

    for raw in sys.stdin:
        line = raw.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except Exception as error:
            _reply({'ok': False, 'error': f'invalid request: {error}'})
            continue

        req_id = req.get('id')
        cmd = req.get('cmd') or 'ocr'

        if cmd in ('quit', 'exit'):
            _reply({'ok': True, 'id': req_id, 'event': 'bye'})
            return 0

        if cmd in ('ping', 'health'):
            _reply({
                'ok': True,
                'id': req_id,
                'event': 'pong',
                'engine': ENGINE,
                'engineVersion': _version(),
            })
            continue

        path = req.get('image_path')
        if not path or not os.path.isfile(path):
            _reply({'ok': False, 'id': req_id, 'error': 'image_path is missing or not a file'})
            continue

        try:
            lines, timing = _run(ocr, path)
            _reply({
                'ok': True,
                'id': req_id,
                'engine': ENGINE,
                'engineVersion': _version(),
                'lines': lines,
                'timing': timing,
            })
        except Exception as error:
            _reply({
                'ok': False,
                'id': req_id,
                'error': str(error),
                'trace': traceback.format_exc()[-2000:],
            })

    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception as error:
        sys.stderr.write(f'openocr worker failed: {error}\n')
        traceback.print_exc()
        raise SystemExit(1)
