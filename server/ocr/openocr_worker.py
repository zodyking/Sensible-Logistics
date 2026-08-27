#!/usr/bin/env python3
"""Persistent OpenOCR worker (JSON lines on stdin/stdout).

Mobile pipeline, matching Topdu/OpenOCR:
  Detector: RepViT DB
  Recognizer: RepSVTR Mobile
  Backend: ONNX
  Device: CPU  (mode=mobile, backend=onnx, use_gpu=false)

The process stays alive so ONNX sessions are not reloaded per photo.

Container numbers on a rear door are upright glyphs stacked down one
corrugation rib. Cropping that rib and rotating it 90° counter-clockwise
turns the column into a single horizontal line the recognizer reads in one
piece, which is far more reliable than stitching loose glyphs together.
"""

from __future__ import annotations

import json
import os
import re
import sys
import tempfile
import traceback

ENGINE = 'openocr'

# OpenOCR sometimes emits CJK lookalikes for a painted Latin I.
_GLYPH_MAP = str.maketrans({
    '一': 'I',
    '丨': 'I',
    '│': 'I',
    '｜': 'I',
})

_ISO_FULL = re.compile(r'[A-Z]{4}\d{7}')
_ISO_LOOSE = re.compile(r'[A-Z0-9]{4}\d{7}')
# Category U is a freight container. Z is a chassis plate and J is detachable
# equipment, so neither may stand in for a door code.
_ISO_PREFIX = re.compile(r'[A-Z]{3}U\d{6}')
_LEADING_ZERO_SERIAL = re.compile(r'[A-Z0-9]{4}0\d{6}')


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
    # A boxed glyph can read as a run of I bars; collapse it to one letter.
    if re.fullmatch(r'I{2,3}', compact):
        return 'I'
    return compact


def _is_container_token(compact: str) -> bool:
    """True when the whole token is an ISO 6346 marking we can trust.

    Substrings are deliberately not accepted: sliding a window across joined
    label text invents check-digit-valid numbers that were never painted.
    """
    if not compact:
        return False
    if _ISO_PREFIX.fullmatch(compact):
        return True
    if len(compact) != 11:
        return False
    if not (_ISO_FULL.fullmatch(compact) or _ISO_LOOSE.fullmatch(compact)):
        return False
    if not re.search(r'[A-Z]', compact[:4]):
        return False
    # A 0 in front of six serial digits is a stacked misread, so keep looking.
    return not _LEADING_ZERO_SERIAL.fullmatch(compact)


def _has_container(lines: list[dict]) -> bool:
    return any(_is_container_token(_compact_text(line.get('text') or '')) for line in lines)


def _merge_lines(*groups: list[dict]) -> list[dict]:
    merged: list[dict] = []
    seen: set[str] = set()
    for group in groups:
        for line in group:
            key = _compact_text(line.get('text') or '')
            if not key or key in seen:
                continue
            seen.add(key)
            merged.append(line)
    return merged


def _box_bounds(box):
    """Return (x0, y0, x1, y1) for a Paddle-style quad or an x,y,w,h box."""
    if not box:
        return None
    try:
        if isinstance(box, (list, tuple)) and len(box) >= 4:
            if all(isinstance(v, (int, float)) for v in box[:4]) and not isinstance(box[0], (list, tuple)):
                x, y, w, h = (float(box[0]), float(box[1]), float(box[2]), float(box[3]))
                return x, y, x + w, y + h
            xs: list[float] = []
            ys: list[float] = []
            for point in box:
                if isinstance(point, (list, tuple)) and len(point) >= 2:
                    xs.append(float(point[0]))
                    ys.append(float(point[1]))
            if len(xs) >= 2:
                return min(xs), min(ys), max(xs), max(ys)
    except (TypeError, ValueError, IndexError):
        return None
    return None


def _box_center(box):
    """Return ((cx, cy), short_side), kept for callers that only need a point."""
    bounds = _box_bounds(box)
    if not bounds:
        return None
    x0, y0, x1, y1 = bounds
    short = min(x1 - x0, y1 - y0) or 8.0
    return ((x0 + x1) / 2.0, (y0 + y1) / 2.0), short


def _placed(lines: list[dict]) -> list[dict]:
    items: list[dict] = []
    for line in lines:
        text = str(line.get('text') or '').strip()
        bounds = _box_bounds(line.get('box'))
        if not text or not bounds:
            continue
        x0, y0, x1, y1 = bounds
        items.append({
            'text': text,
            'score': float(line.get('score') or 0.0),
            'x0': x0,
            'y0': y0,
            'x1': x1,
            'y1': y1,
            'cx': (x0 + x1) / 2.0,
            'cy': (y0 + y1) / 2.0,
            'w': max(1.0, x1 - x0),
            'h': max(1.0, y1 - y0),
        })
    return items


def _emit(items: list[dict]) -> dict:
    joined = ''.join(item['text'] for item in items)
    score = sum(item['score'] for item in items) / len(items)
    return {'text': joined, 'score': score, 'box': None}


def _row_joins(lines: list[dict]) -> list[dict]:
    """Join boxes that share a horizontal line, left to right.

    After a rib crop is rotated, the stacked door code becomes one such row.
    """
    items = _placed(lines)
    if len(items) < 2:
        return []

    rows: list[dict] = []
    for item in sorted(items, key=lambda entry: entry['cy']):
        target = None
        for row in rows:
            if abs(item['cy'] - row['cy']) <= max(row['h'], item['h']) * 0.6:
                target = row
                break
        if target is None:
            rows.append({'cy': item['cy'], 'h': item['h'], 'items': [item]})
        else:
            target['items'].append(item)
            target['h'] = max(target['h'], item['h'])
            target['cy'] = sum(entry['cy'] for entry in target['items']) / len(target['items'])

    out: list[dict] = []
    for row in rows:
        members = sorted(row['items'], key=lambda entry: entry['x0'])
        if len(members) < 2:
            continue
        out.append(_emit(members))
        out.extend(_emit(run) for run in _split_runs(members, 'x', row['h']) if len(run) > 1)
    return out


def _column_joins(lines: list[dict]) -> list[dict]:
    """Join boxes stacked in one vertical column, top to bottom."""
    items = _placed(lines)
    if len(items) < 2:
        return []

    columns: list[dict] = []
    for item in sorted(items, key=lambda entry: entry['cx']):
        target = None
        for column in columns:
            if abs(item['cx'] - column['cx']) <= max(column['w'], item['w']) * 0.9:
                target = column
                break
        if target is None:
            columns.append({'cx': item['cx'], 'w': item['w'], 'items': [item]})
        else:
            target['items'].append(item)
            target['w'] = max(target['w'], item['w'])
            target['cx'] = sum(entry['cx'] for entry in target['items']) / len(target['items'])

    out: list[dict] = []
    for column in columns:
        members = sorted(column['items'], key=lambda entry: entry['y0'])
        if len(members) < 2:
            continue
        out.append(_emit(members))
        gap = sum(entry['h'] for entry in members) / len(members)
        out.extend(_emit(run) for run in _split_runs(members, 'y', gap) if len(run) > 1)
    return out


def _split_runs(members: list[dict], axis: str, size: float) -> list[list[dict]]:
    """Break a row/column where the gap is far wider than one glyph."""
    limit = max(24.0, size * 3.0)
    runs: list[list[dict]] = []
    current: list[dict] = []
    for item in members:
        if current:
            previous = current[-1]
            gap = item[f'{axis}0'] - previous[f'{axis}1']
            if gap > limit:
                runs.append(current)
                current = []
        current.append(item)
    if current:
        runs.append(current)
    return runs if len(runs) > 1 else []


def _joins(lines: list[dict]) -> list[dict]:
    """Spatially ordered joins for one view. No cross-region concatenation."""
    return _merge_lines(_row_joins(lines), _column_joins(lines))


def _workdir() -> str:
    root = os.environ.get('OPENOCR_WORKDIR') or os.path.join(tempfile.gettempdir(), 'openocr')
    os.makedirs(root, exist_ok=True)
    return root


def _save_dir() -> str:
    path = os.path.join(_workdir(), 'e2e_results')
    os.makedirs(path, exist_ok=True)
    return path


def _scaled(img, target_width: float = 1000.0, max_scale: float = 8.0):
    import cv2

    height, width = img.shape[:2]
    if width <= 0 or height <= 0:
        return None
    scale = min(max_scale, max(1.0, target_width / float(width)))
    while scale > 1.0 and (width * scale) * (height * scale) > 4_500_000:
        scale -= 0.5
    if scale <= 1.0:
        return img
    return cv2.resize(
        img,
        (max(1, int(width * scale)), max(1, int(height * scale))),
        interpolation=cv2.INTER_CUBIC,
    )


def _rib_rects(img, lines: list[dict]) -> list[tuple[int, int, int, int]]:
    """Rectangles around columns of short glyphs the first pass already found."""
    items = [item for item in _placed(lines) if len(_compact_text(item['text'])) <= 4]
    if len(items) < 3:
        return []

    height, width = img.shape[:2]
    columns: list[list[dict]] = []
    for item in sorted(items, key=lambda entry: entry['cx']):
        if columns and abs(item['cx'] - columns[-1][-1]['cx']) <= max(item['w'], columns[-1][-1]['w']) * 1.2:
            columns[-1].append(item)
        else:
            columns.append([item])

    rects: list[tuple[int, int, int, int]] = []
    for column in columns:
        if len(column) < 3:
            continue
        span = sum(entry['h'] for entry in column) / len(column)
        pad_x = max(18.0, span * 2.5)
        pad_y = max(24.0, span * 3.0)
        x0 = max(0, int(min(entry['x0'] for entry in column) - pad_x))
        x1 = min(width, int(max(entry['x1'] for entry in column) + pad_x))
        y0 = max(0, int(min(entry['y0'] for entry in column) - pad_y))
        y1 = min(height, int(max(entry['y1'] for entry in column) + pad_y))
        if x1 - x0 > 8 and y1 - y0 > 8:
            rects.append((x0, y0, x1, y1))
    return rects


def _strip_rects(img) -> list[tuple[int, int, int, int]]:
    """Vertical strips across the upper part of the photo, where doors sit."""
    height, width = img.shape[:2]
    y0 = int(height * 0.02)
    y1 = int(height * 0.62)
    rects: list[tuple[int, int, int, int]] = []
    for left in (0.54, 0.66, 0.42, 0.76, 0.30, 0.18):
        x0 = int(width * left)
        x1 = min(width, int(width * (left + 0.24)))
        if x1 - x0 > 8:
            rects.append((x0, y0, x1, y1))
    return rects


def _rotated_views(img, rects: list[tuple[int, int, int, int]]) -> list:
    """Upscale each rib and rotate it so a stacked column reads left to right."""
    import cv2

    views = []
    for x0, y0, x1, y1 in rects:
        tile = img[y0:y1, x0:x1]
        if tile.size == 0 or min(tile.shape[:2]) < 12:
            continue
        scaled = _scaled(tile)
        if scaled is None:
            continue
        views.append(cv2.rotate(scaled, cv2.ROTATE_90_COUNTERCLOCKWISE))
    return views


def _door_code_views(img) -> list:
    """Upscaled upper-right windows, for codes already wide enough to read."""
    import cv2

    height, width = img.shape[:2]
    views = []
    windows = (
        (0.00, 0.55, 0.50, 1.00, 2.0),
        (0.00, 0.50, 0.45, 0.75, 3.0),
        (0.00, 0.50, 0.50, 0.80, 3.0),
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
    return _door_code_pass(ocr, img, lines, timing)


def _door_code_pass(ocr, img, lines: list[dict], timing):
    """Look for the stacked door code the full-frame pass could not resolve.

    Only a whole marking read inside one detection box ends the search. A join
    of loose glyphs can land on a check-digit-valid number that was never
    painted (BSIU 811694-6 for a door reading BSIU 816924-7), so joins are a
    last resort and are dropped once a real read exists.
    """
    reads = list(lines)
    joins = _joins(lines)
    if _has_container(reads):
        return _merge_lines(reads, joins), timing

    views = _rotated_views(img, _rib_rects(img, lines))
    views.extend(_rotated_views(img, _strip_rects(img)))
    views.extend(_door_code_views(img))

    best_timing = timing
    for view in views:
        try:
            extra, extra_timing = _run_numpy(ocr, view)
        except Exception:
            continue
        if extra_timing:
            best_timing = extra_timing
        reads = _merge_lines(reads, extra)
        joins = _merge_lines(joins, _joins(extra))
        if _has_container(reads):
            break

    if _has_container(reads):
        # Keep joins that cannot be mistaken for the container we just read.
        joins = [line for line in joins if not _is_container_token(_compact_text(line.get('text') or ''))]
    return _merge_lines(reads, joins), best_timing


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
