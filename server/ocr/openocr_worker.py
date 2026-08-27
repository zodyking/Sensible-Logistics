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


def _looks_like_equipment(lines: list[dict]) -> bool:
    return bool(re.search(r'[A-Z]{4}\d{6,7}', _compact(lines)))


def _workdir() -> str:
    root = os.environ.get('OPENOCR_WORKDIR') or os.path.join(tempfile.gettempdir(), 'openocr')
    os.makedirs(root, exist_ok=True)
    return root


def _save_dir() -> str:
    path = os.path.join(_workdir(), 'e2e_results')
    os.makedirs(path, exist_ok=True)
    return path


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

    if img is not None:
        out = ocr(img_numpy=img, save_dir=save_dir, is_visualize=False)
    else:
        out = ocr(image_path=image_path, save_dir=save_dir, is_visualize=False)

    if isinstance(out, tuple):
        results = out[0] if out else None
        timing = out[1] if len(out) > 1 else None
    else:
        results, timing = out, None
    return _extract_lines(results), timing


def _rotate_pass(ocr, image_path: str, lines: list[dict], timing):
    if _looks_like_equipment(lines):
        return lines, timing
    try:
        import cv2
    except Exception:
        return lines, timing

    img = cv2.imread(image_path)
    if img is None:
        return lines, timing

    best = (lines, timing)
    for flag in (cv2.ROTATE_90_COUNTERCLOCKWISE, cv2.ROTATE_90_CLOCKWISE):
        fd, tmp = tempfile.mkstemp(suffix='.jpg')
        os.close(fd)
        try:
            cv2.imwrite(tmp, cv2.rotate(img, flag))
            rotated, rotated_timing = _run(ocr, tmp)
            if _looks_like_equipment(rotated):
                return rotated, rotated_timing
            if len(rotated) > len(best[0]):
                best = (rotated, rotated_timing)
        except Exception:
            continue
        finally:
            try:
                os.unlink(tmp)
            except OSError:
                pass
    return best


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
            lines, timing = _rotate_pass(ocr, path, lines, timing)
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
