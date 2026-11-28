from __future__ import annotations

import base64
import io
import json
import os
import threading
import time
from pathlib import Path
from typing import Any

import cv2
import numpy as np
import torch
import torch.nn as nn
from PIL import Image
from torchvision import models, transforms
from ultralytics import YOLO

import Global

BASE_DIR = Path(__file__).resolve().parent
MODELS_DIR = BASE_DIR / "models"
YOLO_WEIGHTS = MODELS_DIR / "hand_yolov8n.pt"
CONVNEXT_CKPT = MODELS_DIR / "convnext_asl.pt"
YUNET_ONNX = MODELS_DIR / "face_detection_yunet_2023mar.onnx"
SFACE_ONNX = MODELS_DIR / "face_recognition_sface_2021dec.onnx"
FACES_DB_PATH = MODELS_DIR / "faces_db.json"

FACE_MATCH_COSINE_THRESHOLD = 0.363

# Maps ASL alphabet / control classes to human-readable hand gestures
ASL_TO_GESTURE: dict[str, str] = {
    "A": "Closed Fist (Thumb Side)",
    "B": "Open Palm (Fingers Together)",
    "C": "Curved C-Shape",
    "D": "Index Pointing Up",
    "E": "Curled Fist",
    "F": "OK / Pinch Circle",
    "G": "Side Pointing",
    "H": "Two-Finger Side Point",
    "I": "Pinky Up",
    "J": "Pinky Hook",
    "K": "Two Fingers + Thumb",
    "L": "L-Shape (Thumb & Index)",
    "M": "Three-Finger Tucked Fist",
    "N": "Two-Finger Tucked Fist",
    "O": "O-Pinch",
    "P": "Downward Two-Finger Point",
    "Q": "Downward Pinch",
    "R": "Crossed Fingers",
    "S": "Closed Fist (Thumb Front)",
    "T": "Thumb Tucked Fist",
    "U": "Two Fingers Up Together",
    "V": "Peace / Victory Sign",
    "W": "Three Fingers Up",
    "X": "Hooked Index",
    "Y": "Hang Loose / Shaka",
    "Z": "Index Trace",
    "del": "Back / Wipe Gesture",
    "space": "Open Flat Hand",
    "nothing": "No Sign / Idle",
}


class HandGestureASLDetector:
    """Real-time YOLO hand + ConvNeXt ASL + YuNet/SFace face recognition pipeline."""

    def __init__(
        self,
        yolo_path: Path = YOLO_WEIGHTS,
        convnext_path: Path = CONVNEXT_CKPT,
        yunet_path: Path = YUNET_ONNX,
        sface_path: Path = SFACE_ONNX,
        faces_db_path: Path = FACES_DB_PATH,
    ) -> None:
        torch.set_num_threads(max(1, os.cpu_count() or 2))
        self.device = torch.device("cpu")
        self._lock = threading.Lock()
        self.faces_db_path = faces_db_path
        self._faces_db_mtime = 0.0
        self.face_gallery: dict[str, list[np.ndarray]] = {}

        if not yolo_path.is_file():
            raise FileNotFoundError(f"YOLO hand weights not found at {yolo_path}")
        if not convnext_path.is_file():
            raise FileNotFoundError(f"ConvNeXt ASL checkpoint not found at {convnext_path}")

        self.yolo = YOLO(str(yolo_path))

        ckpt = torch.load(convnext_path, map_location=self.device, weights_only=True)
        self.classes: list[str] = list(ckpt["classes"])
        self.img_size: int = int(ckpt.get("img_size", 160))

        model = models.convnext_tiny(weights=None)
        in_features = model.classifier[2].in_features
        model.classifier[2] = nn.Linear(in_features, len(self.classes))
        model.load_state_dict(ckpt["model_state"])
        model.eval().to(self.device)
        self.convnext = model

        self.transform = transforms.Compose([
            transforms.Resize((self.img_size, self.img_size)),
            transforms.ToTensor(),
            transforms.Normalize(
                mean=[0.485, 0.456, 0.406],
                std=[0.229, 0.224, 0.225],
            ),
        ])

        self.face_detector: cv2.FaceDetectorYN | None = None
        self.face_recognizer: cv2.FaceRecognizerSF | None = None
        if yunet_path.is_file() and sface_path.is_file():
            self.face_detector = cv2.FaceDetectorYN.create(
                str(yunet_path), "", (320, 240), 0.65, 0.3, 5000
            )
            self.face_recognizer = cv2.FaceRecognizerSF.create(str(sface_path), "")
            self._reload_faces_db_if_needed()

        # Warm up YOLO + ConvNeXt once so the first live frame is fast
        dummy = Image.new("RGB", (320, 320), (128, 128, 128))
        self.yolo.predict(dummy, imgsz=320, conf=0.25, verbose=False)
        with torch.no_grad():
            self.convnext(torch.zeros(1, 3, self.img_size, self.img_size))

    def _reload_faces_db_if_needed(self) -> None:
        if not self.faces_db_path.is_file():
            self.face_gallery = {}
            self._faces_db_mtime = 0.0
            return
        try:
            mtime = self.faces_db_path.stat().st_mtime
            if mtime == self._faces_db_mtime:
                return
            raw = json.loads(self.faces_db_path.read_text(encoding="utf-8"))
            gallery: dict[str, list[np.ndarray]] = {}
            if isinstance(raw, dict):
                for name, vecs in raw.items():
                    if not isinstance(name, str) or not isinstance(vecs, list):
                        continue
                    parsed_vecs = []
                    for v in vecs:
                        arr = np.asarray(v, dtype=np.float32).reshape(1, -1)
                        if arr.size > 0:
                            parsed_vecs.append(arr)
                    if parsed_vecs:
                        gallery[name] = parsed_vecs
            self.face_gallery = gallery
            self._faces_db_mtime = mtime
        except Exception as exc:
            print(f"[ML/W] Failed to load faces_db.json: {exc}")

    @staticmethod
    def _decode_image(image_input: bytes | str | Image.Image) -> Image.Image:
        if isinstance(image_input, Image.Image):
            return image_input.convert("RGB")
        if isinstance(image_input, str):
            raw = image_input
            if "," in raw and raw.startswith("data:"):
                raw = raw.split(",", 1)[1]
            data = base64.b64decode(raw)
            return Image.open(io.BytesIO(data)).convert("RGB")
        return Image.open(io.BytesIO(image_input)).convert("RGB")

    def _classify_crop(self, crop: Image.Image) -> tuple[str, float, list[dict[str, Any]]]:
        tensor = self.transform(crop).unsqueeze(0).to(self.device)
        with torch.no_grad():
            logits = self.convnext(tensor)
            probs = torch.softmax(logits[0], dim=0)
            top_vals, top_idxs = torch.topk(probs, k=min(3, len(self.classes)))

        top3 = [
            {
                "label": self.classes[int(idx)],
                "confidence": round(float(val), 4),
            }
            for val, idx in zip(top_vals.tolist(), top_idxs.tolist())
        ]
        best = top3[0]
        return best["label"], best["confidence"], top3

    def _detect_faces_locked(self, bgr: np.ndarray) -> list[dict[str, Any]]:
        if self.face_detector is None or self.face_recognizer is None:
            return []

        self._reload_faces_db_if_needed()
        h, w = bgr.shape[:2]
        self.face_detector.setInputSize((w, h))
        _, raw_faces = self.face_detector.detect(bgr)
        if raw_faces is None or len(raw_faces) == 0:
            return []

        faces_out: list[dict[str, Any]] = []
        for face_row in raw_faces[:3]:
            fx, fy, fw, fh = [float(v) for v in face_row[:4]]
            det_score = float(face_row[14]) if len(face_row) > 14 else 0.0

            aligned = self.face_recognizer.alignCrop(bgr, face_row)
            feat = self.face_recognizer.feature(aligned)

            best_name = "Unknown Face"
            best_sim = 0.0
            for person_name, embeddings in self.face_gallery.items():
                for ref_feat in embeddings:
                    sim = float(
                        self.face_recognizer.match(
                            feat, ref_feat, cv2.FaceRecognizerSF_FR_COSINE
                        )
                    )
                    if sim > best_sim:
                        best_sim = sim
                        if sim >= FACE_MATCH_COSINE_THRESHOLD:
                            best_name = person_name

            faces_out.append({
                "box": [
                    round(max(0.0, min(1.0, fx / w)), 4),
                    round(max(0.0, min(1.0, fy / h)), 4),
                    round(max(0.0, min(1.0, (fx + fw) / w)), 4),
                    round(max(0.0, min(1.0, (fy + fh) / h)), 4),
                ],
                "score": round(det_score, 4),
                "name": best_name,
                "recognized": best_name != "Unknown Face",
                "similarity": round(best_sim, 4),
            })

        return faces_out

    def enroll_face(self, name: str, image_input: bytes | str | Image.Image) -> dict[str, Any]:
        clean_name = name.strip()
        if not clean_name:
            raise ValueError("Person name cannot be empty.")
        if self.face_detector is None or self.face_recognizer is None:
            raise RuntimeError("Face recognition models are not loaded.")

        rgb = self._decode_image(image_input)
        bgr = cv2.cvtColor(np.array(rgb), cv2.COLOR_RGB2BGR)
        h, w = bgr.shape[:2]

        with self._lock:
            self.face_detector.setInputSize((w, h))
            _, raw_faces = self.face_detector.detect(bgr)
            if raw_faces is None or len(raw_faces) == 0:
                raise ValueError("No face detected in the provided image.")

            # Pick largest detected face
            best_row = max(raw_faces, key=lambda r: float(r[2] * r[3]))
            aligned = self.face_recognizer.alignCrop(bgr, best_row)
            feat = self.face_recognizer.feature(aligned).reshape(-1).tolist()

            existing: dict[str, list[list[float]]] = {}
            if self.faces_db_path.is_file():
                try:
                    loaded = json.loads(self.faces_db_path.read_text(encoding="utf-8"))
                    if isinstance(loaded, dict):
                        existing = loaded
                except Exception:
                    existing = {}

            person_vecs = existing.get(clean_name, [])
            person_vecs.append([round(float(x), 6) for x in feat])
            existing[clean_name] = person_vecs[-10:]  # Keep latest 10 samples per person
            self.faces_db_path.write_text(json.dumps(existing), encoding="utf-8")
            self._faces_db_mtime = 0.0
            self._reload_faces_db_if_needed()

            return {
                "name": clean_name,
                "samples": len(existing[clean_name]),
                "enrolled_people": sorted(existing.keys()),
            }

    def predict(
        self,
        image_input: bytes | str | Image.Image,
        conf_threshold: float = 0.25,
        max_hands: int = 2,
    ) -> dict[str, Any]:
        t0 = time.perf_counter()
        rgb = self._decode_image(image_input)
        width, height = rgb.size
        bgr = cv2.cvtColor(np.array(rgb), cv2.COLOR_RGB2BGR)

        with self._lock:
            results = self.yolo.predict(
                rgb,
                imgsz=320,
                conf=conf_threshold,
                max_det=max_hands,
                verbose=False,
            )

            detections: list[dict[str, Any]] = []
            boxes = results[0].boxes if results and len(results) > 0 else None

            if boxes is not None and len(boxes) > 0:
                xyxy_list = boxes.xyxy.tolist()
                conf_list = boxes.conf.tolist()
                for xyxy, hand_conf in zip(xyxy_list, conf_list):
                    x1, y1, x2, y2 = xyxy
                    bw = max(1.0, x2 - x1)
                    bh = max(1.0, y2 - y1)
                    pad_x = bw * 0.18
                    pad_y = bh * 0.18

                    cx1 = max(0, int(np.floor(x1 - pad_x)))
                    cy1 = max(0, int(np.floor(y1 - pad_y)))
                    cx2 = min(width, int(np.ceil(x2 + pad_x)))
                    cy2 = min(height, int(np.ceil(y2 + pad_y)))
                    if cx2 <= cx1 or cy2 <= cy1:
                        continue

                    crop = rgb.crop((cx1, cy1, cx2, cy2))
                    asl_label, asl_conf, top3 = self._classify_crop(crop)
                    gesture = ASL_TO_GESTURE.get(asl_label, "Hand Gesture")

                    detections.append({
                        "box": [
                            round(max(0.0, min(1.0, x1 / width)), 4),
                            round(max(0.0, min(1.0, y1 / height)), 4),
                            round(max(0.0, min(1.0, x2 / width)), 4),
                            round(max(0.0, min(1.0, y2 / height)), 4),
                        ],
                        "hand_confidence": round(float(hand_conf), 4),
                        "asl_label": asl_label,
                        "asl_confidence": asl_conf,
                        "gesture": gesture,
                        "top3": top3,
                    })

            faces = self._detect_faces_locked(bgr)

        latency_ms = round((time.perf_counter() - t0) * 1000.0, 1)
        primary_face = faces[0] if faces else None

        if detections:
            primary = max(detections, key=lambda d: d["hand_confidence"])
            return {
                "type": "prediction",
                "data_exists": True,
                "model_ready": True,
                "hand_detected": True,
                "asl_label": primary["asl_label"],
                "asl_confidence": primary["asl_confidence"],
                "gesture": primary["gesture"],
                "top3": primary["top3"],
                "detections": detections,
                "face_detected": len(faces) > 0,
                "face_name": primary_face["name"] if primary_face else None,
                "face_recognized": bool(primary_face["recognized"]) if primary_face else False,
                "face_similarity": primary_face["similarity"] if primary_face else 0.0,
                "faces": faces,
                "latency_ms": latency_ms,
            }

        return {
            "type": "prediction",
            "data_exists": True,
            "model_ready": True,
            "hand_detected": False,
            "asl_label": "nothing",
            "asl_confidence": 0.0,
            "gesture": "No Hand Detected",
            "top3": [],
            "detections": [],
            "face_detected": len(faces) > 0,
            "face_name": primary_face["name"] if primary_face else None,
            "face_recognized": bool(primary_face["recognized"]) if primary_face else False,
            "face_similarity": primary_face["similarity"] if primary_face else 0.0,
            "faces": faces,
            "latency_ms": latency_ms,
        }


def ModelL() -> HandGestureASLDetector:
    print("[ML/I] Loading YOLO hand + ConvNeXt ASL + YuNet/SFace face models...")
    detector = HandGestureASLDetector()
    Global.Model = detector
    print(
        f"[ML/I] Models ready ({len(detector.classes)} ASL classes, "
        f"{len(detector.face_gallery)} enrolled faces)."
    )
    return detector


def predict_frame(image_input: bytes | str | Image.Image) -> dict[str, Any]:
    detector: HandGestureASLDetector | None = Global.Model
    if detector is None:
        return {
            "type": "prediction",
            "data_exists": False,
            "model_ready": False,
            "hand_detected": False,
            "asl_label": "nothing",
            "asl_confidence": 0.0,
            "gesture": "Loading AI models...",
            "top3": [],
            "detections": [],
            "face_detected": False,
            "face_name": None,
            "face_recognized": False,
            "face_similarity": 0.0,
            "faces": [],
            "latency_ms": 0.0,
        }
    return detector.predict(image_input)
