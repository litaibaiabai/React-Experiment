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
MAX_REBALANCE_ROUNDS = 1000

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


def ratio(x, total):
    return x / total if total > 0 else 0.0


def sample_rarity_score(sample, image_freq, box_freq):
    """
    稀有类别优先处理。
    """
    score = 0.0
    for c in sample["classes"]:
        score += 1.0 / max(image_freq[c], 1)
    for c, cnt in sample["counts"].items():
        score += 0.3 * cnt / max(box_freq[c], 1)
    score += 0.05 * len(sample["classes"])
    return score


def assignment_score(
    sample,
    put_in_train,
    train_size,
    target_train_size,
    train_image_seen,
    train_box_seen,
    total_image_freq,
    total_box_freq,
    train_ratio,
):
    """
    分数越大越好。
    同时兼顾：
    - 集合大小接近目标
    - 每个类的图片比例接近目标
    - 每个类的框比例接近目标
    """
    score = 0.0

    # 1) 集合大小约束
    before_size_gap = abs(train_size - target_train_size)
    after_size_gap = abs((train_size + (1 if put_in_train else 0)) - target_train_size)
    score += (before_size_gap - after_size_gap) * 8.0

    # 2) image-level
    for c in sample["classes"]:
        total_c = total_image_freq[c]
        old = train_image_seen[c]
        new = old + (1 if put_in_train else 0)

        old_gap = abs(ratio(old, total_c) - train_ratio)
        new_gap = abs(ratio(new, total_c) - train_ratio)
        score += (old_gap - new_gap) * 10.0

    # 3) box-level
    for c, cnt in sample["counts"].items():
        total_c = total_box_freq[c]
        old = train_box_seen[c]
        new = old + (cnt if put_in_train else 0)

        old_gap = abs(ratio(old, total_c) - train_ratio)
        new_gap = abs(ratio(new, total_c) - train_ratio)
        score += (old_gap - new_gap) * 14.0

    return score


def balanced_multilabel_split(samples, train_ratio=0.8, seed=42):
    random.seed(seed)

    total_count = len(samples)
    target_train_size = round(total_count * train_ratio)

    total_image_freq, total_box_freq = compute_stats(samples)

    shuffled = samples[:]
    random.shuffle(shuffled)
    shuffled.sort(
        key=lambda s: (
            sample_rarity_score(s, total_image_freq, total_box_freq),
            sum(s["counts"].values()),
            len(s["classes"]),
        ),
        reverse=True,
    )

    train = []
    val = []
    train_image_seen = Counter()
    train_box_seen = Counter()

    for idx, sample in enumerate(shuffled, start=1):
        if len(train) >= target_train_size:
            val.append(sample)
            continue

        if len(val) >= total_count - target_train_size:
            train.append(sample)
            for c in sample["classes"]:
                train_image_seen[c] += 1
            train_box_seen.update(sample["counts"])
            continue

        score_train = assignment_score(
            sample=sample,
            put_in_train=True,
            train_size=len(train),
            target_train_size=target_train_size,
            train_image_seen=train_image_seen,
            train_box_seen=train_box_seen,
            total_image_freq=total_image_freq,
            total_box_freq=total_box_freq,
            train_ratio=train_ratio,
        )

        score_val = assignment_score(
            sample=sample,
            put_in_train=False,
            train_size=len(train),
            target_train_size=target_train_size,
            train_image_seen=train_image_seen,
            train_box_seen=train_box_seen,
            total_image_freq=total_image_freq,
            total_box_freq=total_box_freq,
            train_ratio=train_ratio,
        )

        if score_train > score_val:
            train.append(sample)
            for c in sample["classes"]:
                train_image_seen[c] += 1
            train_box_seen.update(sample["counts"])
        elif score_val > score_train:
            val.append(sample)
        else:
            # 打平时尽量补小的一边
            train_left = target_train_size - len(train)
            val_left = (total_count - target_train_size) - len(val)
            if train_left >= val_left:
                train.append(sample)
                for c in sample["classes"]:
                    train_image_seen[c] += 1
                train_box_seen.update(sample["counts"])
            else:
                val.append(sample)

        if idx % 100 == 0 or idx == total_count:
            print(f"[初始划分] {idx}/{total_count}", end="\r")

    print()
    return train, val


def ensure_every_class_in_val(train_samples, val_samples):
    while True:
        train_image_freq, train_box_freq = compute_stats(train_samples)
        val_image_freq, _ = compute_stats(val_samples)

        all_classes = sorted(set(train_image_freq.keys()) | set(val_image_freq.keys()))
        missing = [c for c in all_classes if val_image_freq.get(c, 0) == 0]
        if not missing:
            break

        moved_any = False
        for target_class in missing:
            best_idx = None
            best_score = None

            for i, sample in enumerate(train_samples):
                if target_class not in sample["classes"]:
                    continue

                safe = True
                penalty = 0.0

                for cls in sample["classes"]:
                    if train_image_freq[cls] <= 1:
                        safe = False
                        break
                    penalty += 1.0 / max(train_image_freq[cls], 1)

                if not safe:
                    continue

                for cls, cnt in sample["counts"].items():
                    if train_box_freq[cls] - cnt < 1:
                        safe = False
                        break
                    penalty += 0.2 * cnt / max(train_box_freq[cls], 1)

                if not safe:
                    continue

                score = sample["counts"].get(target_class, 0) + 5.0 - penalty
                if best_score is None or score > best_score:
                    best_score = score
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

        all_classes = sorted(
            set(train_box_freq.keys())
            | set(val_box_freq.keys())
            | set(train_image_freq.keys())
            | set(val_image_freq.keys())
        )

        deficits = {c: max(0, min_val_boxes - val_box_freq.get(c, 0)) for c in all_classes}
        need_classes = [c for c in all_classes if deficits[c] > 0]

        if not need_classes:
            return train_samples, val_samples

        target_class = max(need_classes, key=lambda c: deficits[c])

        candidates = []
        for i, sample in enumerate(train_samples):
            if sample["counts"].get(target_class, 0) <= 0:
                continue

            safe = True
            penalty = 0.0
            benefit = 0.0

            for cls in sample["classes"]:
                if train_image_freq[cls] <= 1:
                    safe = False
                    break

            if not safe:
                continue

            for cls, cnt in sample["counts"].items():
                if train_box_freq[cls] - cnt < 1:
                    safe = False
                    break
                penalty += cnt / max(train_box_freq[cls], 1)
                if deficits.get(cls, 0) > 0:
                    benefit += min(cnt, deficits[cls])

            if not safe:
                continue

            target_bonus = sample["counts"].get(target_class, 0) * 10
            score = target_bonus + benefit - penalty
            candidates.append((score, i))

        if not candidates:
            print(f"[提示] 类别 {target_class} 无法继续补到 val >= {min_val_boxes}")
            break

        candidates.sort(reverse=True)
        best_idx = candidates[0][1]
        val_samples.append(train_samples.pop(best_idx))

    return train_samples, val_samples


def choose_most_imbalanced_class(all_samples, train_samples, val_samples, target_ratio):
    all_img, all_box = compute_stats(all_samples)
    train_img, train_box = compute_stats(train_samples)
    val_img, val_box = compute_stats(val_samples)

    all_classes = sorted(set(all_img.keys()) | set(all_box.keys()))
    worst_class = None
    worst_gap = -1.0

    for c in all_classes:
        if all_img.get(c, 0) > 0:
            gap_img = abs(ratio(train_img.get(c, 0), all_img[c]) - target_ratio)
        else:
            gap_img = 0.0

        if all_box.get(c, 0) > 0:
            gap_box = abs(ratio(train_box.get(c, 0), all_box[c]) - target_ratio)
        else:
            gap_box = 0.0

        gap = gap_img + 1.5 * gap_box
        if gap > worst_gap:
            worst_gap = gap
            worst_class = c

    return worst_class, worst_gap


def try_move_for_class_balance(all_samples, train_samples, val_samples, target_ratio):
    all_img, all_box = compute_stats(all_samples)
    train_img, train_box = compute_stats(train_samples)
    val_img, val_box = compute_stats(val_samples)

    target_class, gap = choose_most_imbalanced_class(all_samples, train_samples, val_samples, target_ratio)
    if target_class is None:
        return False, train_samples, val_samples

    current_train_ratio = ratio(train_img.get(target_class, 0), all_img.get(target_class, 0))

    # train里该类过多，则尝试挪到val
    if current_train_ratio > target_ratio:
        best_idx = None
        best_gain = 0.0

        for i, sample in enumerate(train_samples):
            if target_class not in sample["classes"]:
                continue

            # 安全检查：不能把train里某个类彻底挪没
            safe = True
            for cls in sample["classes"]:
                if train_img.get(cls, 0) <= 1:
                    safe = False
                    break
            if not safe:
                continue

            for cls, cnt in sample["counts"].items():
                if train_box.get(cls, 0) - cnt < 1:
                    safe = False
                    break
            if not safe:
                continue

            gain = 0.0
            for cls in sample["classes"]:
                total_c = all_img.get(cls, 0)
                if total_c > 0:
                    old_gap = abs(ratio(train_img.get(cls, 0), total_c) - target_ratio)
                    new_gap = abs(ratio(train_img.get(cls, 0) - 1, total_c) - target_ratio)
                    gain += (old_gap - new_gap)

            for cls, cnt in sample["counts"].items():
                total_c = all_box.get(cls, 0)
                if total_c > 0:
                    old_gap = abs(ratio(train_box.get(cls, 0), total_c) - target_ratio)
                    new_gap = abs(ratio(train_box.get(cls, 0) - cnt, total_c) - target_ratio)
                    gain += 1.5 * (old_gap - new_gap)

            if gain > best_gain:
                best_gain = gain
                best_idx = i

        if best_idx is not None and best_gain > 0:
            val_samples.append(train_samples.pop(best_idx))
            return True, train_samples, val_samples

    # train里该类过少，则尝试从val拉回train
    else:
        best_idx = None
        best_gain = 0.0

        for i, sample in enumerate(val_samples):
            if target_class not in sample["classes"]:
                continue

            gain = 0.0
            for cls in sample["classes"]:
                total_c = all_img.get(cls, 0)
                if total_c > 0:
                    old_gap = abs(ratio(train_img.get(cls, 0), total_c) - target_ratio)
                    new_gap = abs(ratio(train_img.get(cls, 0) + 1, total_c) - target_ratio)
                    gain += (old_gap - new_gap)

            for cls, cnt in sample["counts"].items():
                total_c = all_box.get(cls, 0)
                if total_c > 0:
                    old_gap = abs(ratio(train_box.get(cls, 0), total_c) - target_ratio)
                    new_gap = abs(ratio(train_box.get(cls, 0) + cnt, total_c) - target_ratio)
                    gain += 1.5 * (old_gap - new_gap)

            if gain > best_gain:
                best_gain = gain
                best_idx = i

        if best_idx is not None and best_gain > 0:
            train_samples.append(val_samples.pop(best_idx))
            return True, train_samples, val_samples

    return False, train_samples, val_samples


def rebalance_split(all_samples, train_samples, val_samples, train_ratio=0.8, max_rounds=1000):
    target_train_size = round(len(all_samples) * train_ratio)

    for step in range(1, max_rounds + 1):
        improved = False

        # 先修正集合大小
        if len(train_samples) > target_train_size:
            best_idx = None
            best_score = None

            all_img, all_box = compute_stats(all_samples)
            train_img, train_box = compute_stats(train_samples)

            for i, sample in enumerate(train_samples):
                safe = True
                for cls in sample["classes"]:
                    if train_img.get(cls, 0) <= 1:
                        safe = False
                        break
                if not safe:
                    continue
                for cls, cnt in sample["counts"].items():
                    if train_box.get(cls, 0) - cnt < 1:
                        safe = False
                        break
                if not safe:
                    continue

                score = 0.0
                for cls in sample["classes"]:
                    total_c = all_img.get(cls, 0)
                    old_gap = abs(ratio(train_img.get(cls, 0), total_c) - train_ratio)
                    new_gap = abs(ratio(train_img.get(cls, 0) - 1, total_c) - train_ratio)
                    score += old_gap - new_gap

                for cls, cnt in sample["counts"].items():
                    total_c = all_box.get(cls, 0)
                    old_gap = abs(ratio(train_box.get(cls, 0), total_c) - train_ratio)
                    new_gap = abs(ratio(train_box.get(cls, 0) - cnt, total_c) - train_ratio)
                    score += 1.5 * (old_gap - new_gap)

                if best_score is None or score > best_score:
                    best_score = score
                    best_idx = i

            if best_idx is not None:
                val_samples.append(train_samples.pop(best_idx))
                improved = True

        elif len(train_samples) < target_train_size:
            best_idx = None
            best_score = None

            all_img, all_box = compute_stats(all_samples)
            train_img, train_box = compute_stats(train_samples)

            for i, sample in enumerate(val_samples):
                score = 0.0

                for cls in sample["classes"]:
                    total_c = all_img.get(cls, 0)
                    old_gap = abs(ratio(train_img.get(cls, 0), total_c) - train_ratio)
                    new_gap = abs(ratio(train_img.get(cls, 0) + 1, total_c) - train_ratio)
                    score += old_gap - new_gap

                for cls, cnt in sample["counts"].items():
                    total_c = all_box.get(cls, 0)
                    old_gap = abs(ratio(train_box.get(cls, 0), total_c) - train_ratio)
                    new_gap = abs(ratio(train_box.get(cls, 0) + cnt, total_c) - train_ratio)
                    score += 1.5 * (old_gap - new_gap)

                if best_score is None or score > best_score:
                    best_score = score
                    best_idx = i

            if best_idx is not None:
                train_samples.append(val_samples.pop(best_idx))
                improved = True

        # 再修正类别比例
        changed, train_samples, val_samples = try_move_for_class_balance(
            all_samples=all_samples,
            train_samples=train_samples,
            val_samples=val_samples,
            target_ratio=train_ratio,
        )
        improved = improved or changed

        if step % 50 == 0:
            print(f"[再平衡] round={step}", end="\r")

        if not improved:
            break

    print()
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


def print_ratio_report(all_samples, train_samples, val_samples):
    all_img, all_box = compute_stats(all_samples)
    train_img, train_box = compute_stats(train_samples)
    val_img, val_box = compute_stats(val_samples)

    all_classes = sorted(set(all_img.keys()) | set(all_box.keys()))
    print("\n===== 比例报告 =====")

    for c in all_classes:
        cname = CLASS_NAMES[c] if c < len(CLASS_NAMES) else f"class_{c}"

        img_total = all_img.get(c, 0)
        box_total = all_box.get(c, 0)

        train_img_ratio = ratio(train_img.get(c, 0), img_total)
        val_img_ratio = ratio(val_img.get(c, 0), img_total)
        train_box_ratio = ratio(train_box.get(c, 0), box_total)
        val_box_ratio = ratio(val_box.get(c, 0), box_total)

        print(
            f"class {c:>2} ({cname:<20}) | "
            f"图(train/val)={train_img_ratio:>6.2%}/{val_img_ratio:>6.2%} | "
            f"框(train/val)={train_box_ratio:>6.2%}/{val_box_ratio:>6.2%}"
        )


def check_split_health(all_samples, train_samples, val_samples):
    all_image_freq, all_box_freq = compute_stats(all_samples)
    train_image_freq, train_box_freq = compute_stats(train_samples)
    val_image_freq, val_box_freq = compute_stats(val_samples)

    all_classes = sorted(
        set(all_image_freq.keys())
        | set(all_box_freq.keys())
        | set(train_image_freq.keys())
        | set(train_box_freq.keys())
        | set(val_image_freq.keys())
        | set(val_box_freq.keys())
    )

    print("\n===== 划分检查 =====")

    for c in all_classes:
        cname = CLASS_NAMES[c] if c < len(CLASS_NAMES) else f"class_{c}"

        total_imgs = all_image_freq.get(c, 0)
        total_boxes = all_box_freq.get(c, 0)
        train_imgs = train_image_freq.get(c, 0)
        val_imgs = val_image_freq.get(c, 0)
        train_boxes = train_box_freq.get(c, 0)
        val_boxes = val_box_freq.get(c, 0)

        train_img_ratio = ratio(train_imgs, total_imgs)
        val_img_ratio = ratio(val_imgs, total_imgs)
        train_box_ratio = ratio(train_boxes, total_boxes)
        val_box_ratio = ratio(val_boxes, total_boxes)

        msg = (
            f"class {c:>2} ({cname:<20}) | "
            f"train图={train_imgs:>3}/{total_imgs:<3} ({train_img_ratio:>6.2%}), "
            f"val图={val_imgs:>3}/{total_imgs:<3} ({val_img_ratio:>6.2%}) | "
            f"train框={train_boxes:>3}/{total_boxes:<3} ({train_box_ratio:>6.2%}), "
            f"val框={val_boxes:>3}/{total_boxes:<3} ({val_box_ratio:>6.2%})"
        )

        if val_imgs == 0:
            msg += "  <-- 警告: val中没有该类"
        elif val_boxes < MIN_VAL_BOXES_PER_CLASS:
            msg += f"  <-- 提醒: val框数 < {MIN_VAL_BOXES_PER_CLASS}"
        elif val_img_ratio < 0.10:
            msg += "  <-- 提醒: val图片占比偏低"
        elif val_box_ratio < 0.10:
            msg += "  <-- 提醒: val框占比偏低"

        print(msg)


def split_quality_score(all_samples, train_samples, val_samples, target_ratio=0.8):
    all_img, all_box = compute_stats(all_samples)
    train_img, train_box = compute_stats(train_samples)
    val_img, val_box = compute_stats(val_samples)

    all_classes = sorted(set(all_img.keys()) | set(all_box.keys()))

    score = 100.0
    for c in all_classes:
        if all_img.get(c, 0) > 0:
            score -= abs(ratio(train_img.get(c, 0), all_img[c]) - target_ratio) * 100 * 0.6
        if all_box.get(c, 0) > 0:
            score -= abs(ratio(train_box.get(c, 0), all_box[c]) - target_ratio) * 100 * 0.9

        if val_img.get(c, 0) == 0:
            score -= 20
        if val_box.get(c, 0) < MIN_VAL_BOXES_PER_CLASS:
            score -= 10

    return max(0.0, score)


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

    train_samples, val_samples = balanced_multilabel_split(
        samples=samples,
        train_ratio=TRAIN_RATIO,
        seed=SEED,
    )

    train_samples, val_samples = ensure_every_class_in_val(train_samples, val_samples)
    train_samples, val_samples = force_min_val_boxes(
        train_samples,
        val_samples,
        min_val_boxes=MIN_VAL_BOXES_PER_CLASS,
    )

    train_samples, val_samples = rebalance_split(
        all_samples=samples,
        train_samples=train_samples,
        val_samples=val_samples,
        train_ratio=TRAIN_RATIO,
        max_rounds=MAX_REBALANCE_ROUNDS,
    )

    # 再补一次，防止再平衡后破坏约束
    train_samples, val_samples = ensure_every_class_in_val(train_samples, val_samples)
    train_samples, val_samples = force_min_val_boxes(
        train_samples,
        val_samples,
        min_val_boxes=MIN_VAL_BOXES_PER_CLASS,
    )

    reset_output_dirs()
    copy_samples(train_samples, TRAIN_IMAGES_DIR, TRAIN_LABELS_DIR)
    copy_samples(val_samples, VAL_IMAGES_DIR, VAL_LABELS_DIR)

    print_stats("ALL", samples)
    print_stats("TRAIN", train_samples)
    print_stats("VAL", val_samples)
    check_split_health(samples, train_samples, val_samples)
    print_ratio_report(samples, train_samples, val_samples)

    score = split_quality_score(samples, train_samples, val_samples, target_ratio=TRAIN_RATIO)
    print(f"\n划分评分: {score:.2f}/100")
    if score >= 90:
        print("评价: 优秀")
    elif score >= 75:
        print("评价: 可用")
    else:
        print("评价: 建议继续优化")

    write_dataset_yaml()

    print("\n划分完成：")
    print(f"训练集: {TRAIN_IMAGES_DIR.parent}")
    print(f"验证集: {VAL_IMAGES_DIR.parent}")
    print(f"YAML文件: {DATASET_DIR / 'dataset.yaml'}")


if __name__ == "__main__":
    main()