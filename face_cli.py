import argparse
import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

from ML import FACES_DB_PATH, SFACE_ONNX, YUNET_ONNX


def load_face_models() -> tuple[cv2.FaceDetectorYN, cv2.FaceRecognizerSF]:
    detector = cv2.FaceDetectorYN.create(str(YUNET_ONNX), "", (320, 240), 0.65, 0.3, 5000)
    recognizer = cv2.FaceRecognizerSF.create(str(SFACE_ONNX), "")
    return detector, recognizer


def cmd_list() -> None:
    if not FACES_DB_PATH.is_file():
        print(json.dumps({"faces": []}))
        return
    raw = json.loads(FACES_DB_PATH.read_text(encoding="utf-8"))
    faces = [
        {"name": name, "samples": len(vecs)}
        for name, vecs in sorted(raw.items())
        if isinstance(vecs, list)
    ]
    print(json.dumps({"faces": faces}))


def cmd_enroll(name: str, image_path: Path) -> None:
    clean_name = name.strip()
    if not clean_name:
        raise SystemExit("Person name is required.")
    if not image_path.is_file():
        raise SystemExit(f"Image not found: {image_path}")

    detector, recognizer = load_face_models()
    with Image.open(image_path) as img:
        rgb = img.convert("RGB")
        bgr = cv2.cvtColor(np.array(rgb), cv2.COLOR_RGB2BGR)

    h, w = bgr.shape[:2]
    detector.setInputSize((w, h))
    _, raw_faces = detector.detect(bgr)
    if raw_faces is None or len(raw_faces) == 0:
        raise SystemExit("No face detected in the selected capture.")

    best_row = max(raw_faces, key=lambda r: float(r[2] * r[3]))
    aligned = recognizer.alignCrop(bgr, best_row)
    feat = recognizer.feature(aligned).reshape(-1).tolist()

    existing: dict[str, list[list[float]]] = {}
    if FACES_DB_PATH.is_file():
        try:
            loaded = json.loads(FACES_DB_PATH.read_text(encoding="utf-8"))
            if isinstance(loaded, dict):
                existing = loaded
        except Exception:
            existing = {}

    vecs = existing.get(clean_name, [])
    vecs.append([round(float(x), 6) for x in feat])
    existing[clean_name] = vecs[-10:]
    FACES_DB_PATH.write_text(json.dumps(existing), encoding="utf-8")
    print(json.dumps({"ok": True, "name": clean_name, "samples": len(existing[clean_name])}))


def cmd_delete(name: str) -> None:
    if not FACES_DB_PATH.is_file():
        print(json.dumps({"ok": True, "deleted": False}))
        return
    raw = json.loads(FACES_DB_PATH.read_text(encoding="utf-8"))
    existed = name in raw
    raw.pop(name, None)
    FACES_DB_PATH.write_text(json.dumps(raw), encoding="utf-8")
    print(json.dumps({"ok": True, "deleted": existed}))


def main() -> None:
    parser = argparse.ArgumentParser(description="Manage enrolled faces for SFace recognition.")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("list")

    enroll_p = sub.add_parser("enroll")
    enroll_p.add_argument("--name", required=True)
    enroll_p.add_argument("--image", required=True)

    del_p = sub.add_parser("delete")
    del_p.add_argument("--name", required=True)

    args = parser.parse_args()
    if args.command == "list":
        cmd_list()
    elif args.command == "enroll":
        cmd_enroll(args.name, Path(args.image))
    elif args.command == "delete":
        cmd_delete(args.name)


if __name__ == "__main__":
    main()
