import random
import shutil
from collections import Counter
from pathlib import Path

DATASET_DIR = Path("dataset")
IMAGES_DIR = DATASET_DIR / "images"
LABELS_DIR = DATASET_DIR / "labels"

TRAIN_RATIO = 0.8
SEED = 42
MIN_VAL_BOXES_PER_CLASS = 3

CLASS_NAMES = [
    "wire",
    "battery",
    "switch",
    "batteryComp",
    "lightbulb",
    "lightbulbModel",
    "switchConnected",
    "batteryConnected",
    "lightbulbConnected",
    "lightbulbOrange",
    "switchClosed",
]

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}

TRAIN_IMAGES_DIR = DATASET_DIR / "train" / "images"
TRAIN_LABELS_DIR = DATASET_DIR / "train" / "labels"
VAL_IMAGES_DIR = DATASET_DIR / "val" / "images"
VAL_LABELS_DIR = DATASET_DIR / "val" / "labels"


def reset_output_dirs():
    for d in [TRAIN_IMAGES_DIR, TRAIN_LABELS_DIR, VAL_IMAGES_DIR, VAL_LABELS_DIR]:
        if d.exists():
            shutil.rmtree(d)
        d.mkdir(parents=True, exist_ok=True)


def find_image_for_label(stem: str):
    for ext in IMAGE_EXTS:
        p = IMAGES_DIR / f"{stem}{ext}"
        if p.exists():
            return p
    return None


def parse_label_file(label_path: Path):
    classes_present = set()
    class_counts = Counter()

    with open(label_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            parts = line.split()
            if len(parts) < 5:
                continue
            try:
                cid = int(parts[0])
            except ValueError:
                continue
            classes_present.add(cid)
            class_counts[cid] += 1

    return classes_present, class_counts


def collect_samples():
    samples = []
    label_files = sorted(LABELS_DIR.glob("*.txt"))
    if not label_files:
        raise RuntimeError(f"在 {LABELS_DIR} 下没有找到 .txt 标注文件")

    for label_path in label_files:
        stem = label_path.stem
        image_path = find_image_for_label(stem)
        if image_path is None:
            print(f"[警告] 没找到对应图片，跳过: {label_path.name}")
            continue

        classes_present, class_counts = parse_label_file(label_path)
        samples.append({
            "stem": stem,
            "image": image_path,
            "label": label_path,
            "classes": classes_present,
            "counts": class_counts,
        })

    if not samples:
        raise RuntimeError("没有可用样本，请检查 images/labels 是否匹配")

    return samples


def compute_stats(samples):
    image_freq = Counter()
    box_freq = Counter()
    for s in samples:
        for c in s["classes"]:
            image_freq[c] += 1
        box_freq.update(s["counts"])
    return image_freq, box_freq


def greedy_multilabel_split(samples, train_ratio=0.8, seed=42):
    random.seed(seed)

    total_count = len(samples)
    target_train_size = round(total_count * train_ratio)

    image_freq, _ = compute_stats(samples)

    target_train_per_class = {
        c: round(freq * train_ratio) for c, freq in image_freq.items()
    }

    def rarity_score(sample):
        if not sample["classes"]:
            return 0
        return sum(1 / image_freq[c] for c in sample["classes"])

    shuffled = samples[:]
    random.shuffle(shuffled)
    shuffled.sort(key=rarity_score, reverse=True)

    train = []
    val = []

    train_class_seen = Counter()
    val_class_seen = Counter()

    for sample in shuffled:
        if not sample["classes"]:
            if len(train) < target_train_size:
                train.append(sample)
            else:
                val.append(sample)
            continue

        train_gain = 0
        val_gain = 0

        for c in sample["classes"]:
            train_deficit = target_train_per_class[c] - train_class_seen[c]
            if train_deficit > 0:
                train_gain += train_deficit

            target_val = image_freq[c] - target_train_per_class[c]
            val_deficit = target_val - val_class_seen[c]
            if val_deficit > 0:
                val_gain += val_deficit

        train_left = target_train_size - len(train)
        val_left = (total_count - target_train_size) - len(val)

        if train_left <= 0:
            choose_train = False
        elif val_left <= 0:
            choose_train = True
        else:
            if train_gain > val_gain:
                choose_train = True
            elif train_gain < val_gain:
                choose_train = False
            else:
                choose_train = train_left >= val_left

        if choose_train:
            train.append(sample)
            for c in sample["classes"]:
                train_class_seen[c] += 1
        else:
            val.append(sample)
            for c in sample["classes"]:
                val_class_seen[c] += 1

    return train, val


def ensure_every_class_in_val(train_samples, val_samples):
    while True:
        train_image_freq, _ = compute_stats(train_samples)
        val_image_freq, _ = compute_stats(val_samples)

        all_classes = sorted(set(train_image_freq.keys()) | set(val_image_freq.keys()))
        missing = [c for c in all_classes if val_image_freq.get(c, 0) == 0]
        if not missing:
            break

        moved_any = False
        for target_class in missing:
            best_idx = None
            best_penalty = None

            for i, sample in enumerate(train_samples):
                if target_class not in sample["classes"]:
                    continue

                penalty = 0
                safe = True
                for cls in sample["classes"]:
                    if train_image_freq[cls] <= 1:
                        safe = False
                        break
                    penalty += 1 / train_image_freq[cls]

                if not safe:
                    continue

                if best_penalty is None or penalty < best_penalty:
                    best_penalty = penalty
                    best_idx = i

            if best_idx is not None:
                val_samples.append(train_samples.pop(best_idx))
                moved_any = True
                break

        if not moved_any:
            break

    return train_samples, val_samples


def force_min_val_boxes(train_samples, val_samples, min_val_boxes=3, max_rounds=500):
    """
    强制让每个类别在 val 至少有 min_val_boxes 个框
    """
    for _ in range(max_rounds):
        train_image_freq, train_box_freq = compute_stats(train_samples)
        val_image_freq, val_box_freq = compute_stats(val_samples)

        all_classes = sorted(set(train_box_freq.keys()) | set(val_box_freq.keys()))
        deficits = {c: max(0, min_val_boxes - val_box_freq.get(c, 0)) for c in all_classes}
        need_classes = [c for c in all_classes if deficits[c] > 0]

        if not need_classes:
            return train_samples, val_samples

        # 先补最缺的类
        target_class = max(need_classes, key=lambda c: deficits[c])

        candidates = []
        for i, sample in enumerate(train_samples):
            if sample["counts"].get(target_class, 0) <= 0:
                continue

            # 检查挪走后 train 是否还安全
            safe = True
            penalty = 0.0
            benefit = 0.0

            for cls, cnt in sample["counts"].items():
                if train_box_freq[cls] - cnt < 1:
                    safe = False
                    break
                penalty += cnt / max(train_box_freq[cls], 1)
                if deficits.get(cls, 0) > 0:
                    benefit += min(cnt, deficits[cls])

            if not safe:
                continue

            # 优先补 target_class 多的图，其次兼顾其他缺口类
            target_bonus = sample["counts"].get(target_class, 0) * 10
            score = target_bonus + benefit - penalty
            candidates.append((score, i))

        if not candidates:
            print(f"[提示] 类别 {target_class} 无法继续补到 val>={min_val_boxes}")
            break

        candidates.sort(reverse=True)
        best_idx = candidates[0][1]
        val_samples.append(train_samples.pop(best_idx))

    return train_samples, val_samples


def copy_samples(samples, images_out_dir: Path, labels_out_dir: Path):
    for s in samples:
        shutil.copy2(s["image"], images_out_dir / s["image"].name)
        shutil.copy2(s["label"], labels_out_dir / s["label"].name)


def print_stats(name, samples):
    image_freq, box_freq = compute_stats(samples)
    all_classes = sorted(set(image_freq.keys()) | set(box_freq.keys()))

    print(f"\n===== {name} =====")
    print(f"样本数: {len(samples)}")

    print("按“包含该类的图片数”统计:")
    for c in all_classes:
        cname = CLASS_NAMES[c] if c < len(CLASS_NAMES) else f"class_{c}"
        print(f"  class {c:>2} ({cname:<20}): {image_freq.get(c, 0)}")

    print("按“标注框数量”统计:")
    for c in all_classes:
        cname = CLASS_NAMES[c] if c < len(CLASS_NAMES) else f"class_{c}"
        print(f"  class {c:>2} ({cname:<20}): {box_freq.get(c, 0)}")


def check_split_health(train_samples, val_samples):
    train_image_freq, train_box_freq = compute_stats(train_samples)
    val_image_freq, val_box_freq = compute_stats(val_samples)

    all_classes = sorted(set(train_image_freq.keys()) | set(val_image_freq.keys()))
    print("\n===== 划分检查 =====")

    for c in all_classes:
        cname = CLASS_NAMES[c] if c < len(CLASS_NAMES) else f"class_{c}"
        train_imgs = train_image_freq.get(c, 0)
        val_imgs = val_image_freq.get(c, 0)
        train_boxes = train_box_freq.get(c, 0)
        val_boxes = val_box_freq.get(c, 0)

        msg = (
            f"class {c:>2} ({cname:<20}) | "
            f"train图={train_imgs:>3}, val图={val_imgs:>3}, "
            f"train框={train_boxes:>3}, val框={val_boxes:>3}"
        )

        if val_imgs == 0:
            msg += "  <-- 警告: val中没有该类"
        elif val_boxes < MIN_VAL_BOXES_PER_CLASS:
            msg += f"  <-- 提醒: val框数 < {MIN_VAL_BOXES_PER_CLASS}"

        print(msg)


def write_dataset_yaml():
    yaml_path = DATASET_DIR / "dataset.yaml"
    lines = [
        f"path: {DATASET_DIR.resolve()}",
        "train: train/images",
        "val: val/images",
        "",
        f"nc: {len(CLASS_NAMES)}",
        "names:",
    ]
    for i, name in enumerate(CLASS_NAMES):
        lines.append(f"  {i}: {name}")

    yaml_path.write_text("\n".join(lines), encoding="utf-8")
    print(f"\n已生成: {yaml_path}")


def main():
    if not IMAGES_DIR.exists():
        raise RuntimeError(f"图片目录不存在: {IMAGES_DIR}")
    if not LABELS_DIR.exists():
        raise RuntimeError(f"标注目录不存在: {LABELS_DIR}")

    samples = collect_samples()
    print(f"总样本数: {len(samples)}")

    train_samples, val_samples = greedy_multilabel_split(
        samples=samples,
        train_ratio=TRAIN_RATIO,
        seed=SEED,
    )

    train_samples, val_samples = ensure_every_class_in_val(train_samples, val_samples)
    train_samples, val_samples = force_min_val_boxes(
        train_samples, val_samples, min_val_boxes=MIN_VAL_BOXES_PER_CLASS
    )

    reset_output_dirs()
    copy_samples(train_samples, TRAIN_IMAGES_DIR, TRAIN_LABELS_DIR)
    copy_samples(val_samples, VAL_IMAGES_DIR, VAL_LABELS_DIR)

    print_stats("ALL", samples)
    print_stats("TRAIN", train_samples)
    print_stats("VAL", val_samples)
    check_split_health(train_samples, val_samples)
    write_dataset_yaml()

    print("\n划分完成：")
    print(f"训练集: {TRAIN_IMAGES_DIR.parent}")
    print(f"验证集: {VAL_IMAGES_DIR.parent}")
    print(f"YAML文件: {DATASET_DIR / 'dataset.yaml'}")


if __name__ == "__main__":
    main()