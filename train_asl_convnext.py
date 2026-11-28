import argparse
import json
import os
import random
import time
from pathlib import Path

import kagglehub
import torch
import torch.nn as nn
from PIL import Image
from torch.utils.data import DataLoader, Dataset
from torchvision import models, transforms
from ultralytics import YOLO

SEED = 42
TRAIN_PER_CLASS = 100
VAL_PER_CLASS = 20
EPOCHS = 3
BATCH_SIZE = 32
IMG_SIZE = 160
LR = 3e-4

BASE_DIR = Path(__file__).resolve().parent
MODELS_DIR = BASE_DIR / "models"
CUSTOM_ASL_DIR = BASE_DIR / "Data" / "custom_asl"
OUTPUT_CKPT = MODELS_DIR / "convnext_asl.pt"
YOLO_WEIGHTS = MODELS_DIR / "hand_yolov8n.pt"


def set_seed(seed: int) -> None:
    random.seed(seed)
    torch.manual_seed(seed)


class PathImageDataset(Dataset):
    def __init__(self, samples: list[tuple[Path, int]], transform: transforms.Compose):
        self.samples = samples
        self.transform = transform

    def __len__(self) -> int:
        return len(self.samples)

    def __getitem__(self, idx: int) -> tuple[torch.Tensor, int]:
        img_path, label = self.samples[idx]
        with Image.open(img_path) as img:
            rgb = img.convert("RGB")
            return self.transform(rgb), label


def collect_splits(train_root: Path) -> tuple[list[str], list[tuple[Path, int]], list[tuple[Path, int]]]:
    classes = sorted([d.name for d in train_root.iterdir() if d.is_dir()])
    train_samples: list[tuple[Path, int]] = []
    val_samples: list[tuple[Path, int]] = []

    rng = random.Random(SEED)
    for class_idx, class_name in enumerate(classes):
        class_dir = train_root / class_name
        files = sorted(
            [p for p in class_dir.iterdir() if p.suffix.lower() in {".jpg", ".jpeg", ".png"}]
        )
        # Sample evenly across the 3000 sequential frames so lighting/pose variations are covered
        total_needed = TRAIN_PER_CLASS + VAL_PER_CLASS
        step = max(1, len(files) // total_needed)
        picked = files[::step][:total_needed]
        if len(picked) < total_needed:
            picked = files[:total_needed]
        rng.shuffle(picked)
        val_files = picked[:VAL_PER_CLASS]
        train_files = picked[VAL_PER_CLASS : VAL_PER_CLASS + TRAIN_PER_CLASS]

        for p in train_files:
            train_samples.append((p, class_idx))
        for p in val_files:
            val_samples.append((p, class_idx))

    return classes, train_samples, val_samples


def build_model(num_classes: int, pretrained: bool = True) -> nn.Module:
    weights = models.ConvNeXt_Tiny_Weights.IMAGENET1K_V1 if pretrained else None
    model = models.convnext_tiny(weights=weights)
    in_features = model.classifier[2].in_features
    model.classifier[2] = nn.Linear(in_features, num_classes)
    return model


def evaluate(model: nn.Module, loader: DataLoader, device: torch.device) -> float:
    model.eval()
    correct = 0
    total = 0
    with torch.no_grad():
        for images, labels in loader:
            images = images.to(device)
            labels = labels.to(device)
            logits = model(images)
            preds = logits.argmax(dim=1)
            correct += int((preds == labels).sum().item())
            total += labels.size(0)
    return (correct / total) if total > 0 else 0.0


def evaluate_yolo_cropped_test(
    model: nn.Module,
    classes: list[str],
    test_root: Path,
    eval_transform: transforms.Compose,
    device: torch.device,
) -> tuple[float, int, int]:
    if not test_root.exists() or not YOLO_WEIGHTS.exists():
        return 0.0, 0, 0

    yolo = YOLO(str(YOLO_WEIGHTS))
    class_to_idx = {c: i for i, c in enumerate(classes)}
    model.eval()

    correct = 0
    total = 0
    for img_path in sorted(test_root.glob("*.jpg")):
        label_name = img_path.stem.replace("_test", "")
        if label_name not in class_to_idx:
            continue
        with Image.open(img_path) as img:
            rgb = img.convert("RGB")
            w, h = rgb.size
            results = yolo.predict(rgb, imgsz=320, conf=0.2, verbose=False)
            crop = rgb
            if results and len(results[0].boxes) > 0:
                box = results[0].boxes[0].xyxy[0].tolist()
                bw = box[2] - box[0]
                bh = box[3] - box[1]
                pad_x = bw * 0.18
                pad_y = bh * 0.18
                x1 = max(0, int(box[0] - pad_x))
                y1 = max(0, int(box[1] - pad_y))
                x2 = min(w, int(box[2] + pad_x))
                y2 = min(h, int(box[3] + pad_y))
                if x2 > x1 and y2 > y1:
                    crop = rgb.crop((x1, y1, x2, y2))

            tensor = eval_transform(crop).unsqueeze(0).to(device)
            with torch.no_grad():
                pred_idx = int(model(tensor).argmax(dim=1).item())
            if pred_idx == class_to_idx[label_name]:
                correct += 1
            total += 1

    return (correct / total) if total > 0 else 0.0, correct, total


def collect_custom_samples(
    classes: list[str],
    custom_root: Path,
) -> list[tuple[Path, int]]:
    if not custom_root.is_dir():
        return []
    class_to_idx = {c: i for i, c in enumerate(classes)}
    extra: list[tuple[Path, int]] = []
    for class_dir in custom_root.iterdir():
        if not class_dir.is_dir() or class_dir.name not in class_to_idx:
            continue
        idx = class_to_idx[class_dir.name]
        for p in sorted(class_dir.iterdir()):
            if p.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"}:
                extra.append((p, idx))
    return extra


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--include-captures",
        action="store_true",
        help="Include consented admin-labeled photos from Data/custom_asl",
    )
    parser.add_argument("--epochs", type=int, default=EPOCHS)
    args = parser.parse_args()

    set_seed(SEED)
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    torch.set_num_threads(max(1, os.cpu_count() or 2))

    dataset_root = Path(kagglehub.dataset_download("grassknoted/asl-alphabet"))
    train_root = dataset_root / "asl_alphabet_train" / "asl_alphabet_train"
    test_root = dataset_root / "asl_alphabet_test" / "asl_alphabet_test"

    classes, train_samples, val_samples = collect_splits(train_root)
    if args.include_captures:
        custom_samples = collect_custom_samples(classes, CUSTOM_ASL_DIR)
        if custom_samples:
            # Weight consented real-camera samples so the model adapts to live webcam lighting
            train_samples.extend(custom_samples * 3)
            print(f"Included {len(custom_samples)} custom consented capture(s) into training set.")

    epochs = max(1, args.epochs)
    print(f"Classes: {len(classes)} | Train samples: {len(train_samples)} | Val samples: {len(val_samples)}")

    train_transform = transforms.Compose([
        transforms.RandomResizedCrop(IMG_SIZE, scale=(0.6, 1.0), ratio=(0.85, 1.15)),
        transforms.RandomHorizontalFlip(p=0.5),
        transforms.RandomRotation(degrees=15),
        transforms.ColorJitter(brightness=0.25, contrast=0.25, saturation=0.2),
        transforms.ToTensor(),
        transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
    ])
    eval_transform = transforms.Compose([
        transforms.Resize((IMG_SIZE, IMG_SIZE)),
        transforms.ToTensor(),
        transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
    ])

    train_loader = DataLoader(
        PathImageDataset(train_samples, train_transform),
        batch_size=BATCH_SIZE,
        shuffle=True,
        num_workers=0,
    )
    val_loader = DataLoader(
        PathImageDataset(val_samples, eval_transform),
        batch_size=BATCH_SIZE,
        shuffle=False,
        num_workers=0,
    )

    device = torch.device("cpu")
    model = build_model(len(classes), pretrained=True).to(device)

    # Freeze early stages so CPU fine-tuning is fast while adapting high-level features + head
    for param in model.features.parameters():
        param.requires_grad = False
    for param in model.features[7].parameters():
        param.requires_grad = True
    for param in model.classifier.parameters():
        param.requires_grad = True

    trainable_params = [p for p in model.parameters() if p.requires_grad]
    optimizer = torch.optim.AdamW(trainable_params, lr=LR, weight_decay=1e-4)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=epochs * len(train_loader))
    criterion = nn.CrossEntropyLoss(label_smoothing=0.05)

    best_val_acc = 0.0
    for epoch in range(1, epochs + 1):
        t0 = time.time()
        model.train()
        running_loss = 0.0
        for step, (images, labels) in enumerate(train_loader, start=1):
            images = images.to(device)
            labels = labels.to(device)

            optimizer.zero_grad()
            logits = model(images)
            loss = criterion(logits, labels)
            loss.backward()
            optimizer.step()
            scheduler.step()

            running_loss += float(loss.item())
            if step % 30 == 0 or step == len(train_loader):
                print(
                    f"Epoch {epoch}/{epochs} [{step}/{len(train_loader)}] "
                    f"loss={running_loss / step:.4f}"
                )

        val_acc = evaluate(model, val_loader, device)
        elapsed = time.time() - t0
        print(f"Epoch {epoch} done in {elapsed:.1f}s | val_acc={val_acc * 100:.2f}%")

        if val_acc >= best_val_acc:
            best_val_acc = val_acc
            torch.save(
                {
                    "model_state": model.state_dict(),
                    "classes": classes,
                    "img_size": IMG_SIZE,
                    "val_acc": val_acc,
                },
                OUTPUT_CKPT,
            )

    ckpt = torch.load(OUTPUT_CKPT, map_location=device, weights_only=True)
    model.load_state_dict(ckpt["model_state"])
    yolo_test_acc, correct, total = evaluate_yolo_cropped_test(
        model, classes, test_root, eval_transform, device
    )
    print(
        json.dumps(
            {
                "saved_to": str(OUTPUT_CKPT),
                "best_val_acc": round(best_val_acc, 4),
                "yolo_cropped_test_acc": round(yolo_test_acc, 4),
                "yolo_cropped_test_correct": f"{correct}/{total}",
            }
        )
    )


if __name__ == "__main__":
    main()
