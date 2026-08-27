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

ENGINE = 'openocr'


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
        cleaned = str(text or '').strip()
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


def _compact(lines: list[dict]) -> str:
    blob = ''.join(line.get('text', '') for line in lines).upper()
    return re.sub(r'[^A-Z0-9]', '', blob)


def _has_container(lines: list[dict]) -> bool:
    """ISO 6346 door code: four letters + seven digits (the boxed check digit)."""
    return bool(re.search(r'[A-Z]{4}\d{7}', _compact(lines)))


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
        joined = ''.join(row[3] for row in column)
        compact = re.sub(r'[^A-Z0-9]', '', joined.upper())
        if len(compact) < 4:
            continue
        score = sum(float(row[4] or 0) for row in column) / len(column)
        extra.append({'text': joined, 'score': score, 'box': None})
    return extra


def _workdir() -> str:
    root = os.environ.get('OPENOCR_WORKDIR') or os.path.join(tempfile.gettempdir(), 'openocr')
    os.makedirs(root, exist_ok=True)
    return root


def _save_dir() -> str:
    path = os.path.join(_workdir(), 'e2e_results')
    os.makedirs(path, exist_ok=True)
    return path


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
    """Keep the upright reading and add 90° passes for vertical door codes.

    Chassis plates are usually horizontal. ISO container markings on the door
    are often stacked vertically. The first pass therefore often finds the
    chassis and used to skip rotation — which dropped the container. Merge
    every orientation instead of replacing the original lines.
    """
    combined = _merge_lines(lines, _column_stitches(lines))
    if _has_container(combined):
        return combined, timing

    try:
        import cv2
    except Exception:
        return combined, timing

    best_timing = timing
    for flag in (cv2.ROTATE_90_COUNTERCLOCKWISE, cv2.ROTATE_90_CLOCKWISE):
        try:
            rotated, rotated_timing = _run_numpy(ocr, cv2.rotate(img, flag))
            combined = _merge_lines(combined, rotated, _column_stitches(rotated))
            if rotated_timing:
                best_timing = rotated_timing
            if _has_container(combined):
                return combined, best_timing
        except Exception:
            continue
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
