from ultralytics import YOLO
from pathlib import Path
from collections import Counter
import cv2

# =========================
# 配置
# =========================
MODEL_PATH = "best.pt"
DATA_DIR = Path("data")
RESULT_DIR = Path("result")

CONF_THRES = 0.25
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}

# 类别名称，顺序要与训练时一致
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

# =========================
# 状态规则
# 严格匹配：指定类数量必须一致，其他类必须为 0
# =========================
INIT_RULE = {
    "wire": 3,
    "battery": 1,
    "switch": 1,
    "batteryComp": 1,
    "lightbulb": 1,
    "lightbulbModel": 1,
}

CONNECT_RULE = {
    "switchConnected": 1,
    "batteryConnected": 1,
    "lightbulbConnected": 1,
}

FINISH_RULE = {
    "batteryConnected": 1,
    "lightbulbOrange": 1,
    "switchClosed": 1,
}


def find_images(root: Path):
    return [p for p in root.rglob("*") if p.suffix.lower() in IMAGE_EXTS]


def ensure_dirs():
    for sub in ["init", "connect", "finish", "unknown"]:
        (RESULT_DIR / sub).mkdir(parents=True, exist_ok=True)


def count_predicted_classes(result, class_names):
    """
    统计当前图片中每个类别的检测框数量
    """
    counter = Counter()

    if result.boxes is None or len(result.boxes) == 0:
        return counter

    cls_ids = result.boxes.cls.cpu().numpy().astype(int).tolist()
    for cid in cls_ids:
        if 0 <= cid < len(class_names):
            counter[class_names[cid]] += 1

    return counter


def strict_match(pred_counter: Counter, rule: dict, all_classes: list[str]) -> bool:
    """
    严格匹配：
    1. rule 中列出的类别数量必须完全一致
    2. 不在 rule 中的类别数量必须为 0
    """
    for cls_name, required_count in rule.items():
        if pred_counter.get(cls_name, 0) != required_count:
            return False

    for cls_name in all_classes:
        if cls_name not in rule and pred_counter.get(cls_name, 0) != 0:
            return False

    return True


def classify_state(pred_counter: Counter, all_classes: list[str]) -> str:
    """
    返回分类结果：init / connect / finish / unknown
    优先级：finish > connect > init
    """
    if strict_match(pred_counter, FINISH_RULE, all_classes):
        return "finish"
    if strict_match(pred_counter, CONNECT_RULE, all_classes):
        return "connect"
    if strict_match(pred_counter, INIT_RULE, all_classes):
        return "init"
    return "unknown"


def save_image(save_path: Path, image):
    """
    兼容中文路径保存
    """
    save_path.parent.mkdir(parents=True, exist_ok=True)
    suffix = save_path.suffix if save_path.suffix else ".jpg"
    ok, buffer = cv2.imencode(suffix, image)
    if not ok:
        raise RuntimeError(f"保存失败: {save_path}")
    buffer.tofile(str(save_path))


def main():
    if not Path(MODEL_PATH).exists():
        raise FileNotFoundError(f"模型文件不存在: {MODEL_PATH}")

    if not DATA_DIR.exists():
        raise FileNotFoundError(f"数据目录不存在: {DATA_DIR}")

    ensure_dirs()

    model = YOLO(MODEL_PATH)
    images = find_images(DATA_DIR)

    if not images:
        print(f"在 {DATA_DIR} 下没有找到图片")
        return

    print(f"共找到 {len(images)} 张图片")

    summary = Counter()

    for idx, img_path in enumerate(images, start=1):
        print(f"[{idx}/{len(images)}] 处理中: {img_path}")

        results = model.predict(
            source=str(img_path),
            conf=CONF_THRES,
            verbose=False
        )

        if not results:
            print("  -> 推理失败，跳过")
            continue

        result = results[0]
        pred_counter = count_predicted_classes(result, CLASS_NAMES)
        state = classify_state(pred_counter, CLASS_NAMES)

        annotated = result.plot()

        save_path = RESULT_DIR / state / img_path.name
        save_image(save_path, annotated)

        summary[state] += 1

        print(f"  -> 分类结果: {state}")
        print(f"  -> 检测计数: {dict(pred_counter)}")

    print("\n处理完成")
    print("分类统计：")
    print(f"  init    : {summary['init']}")
    print(f"  connect : {summary['connect']}")
    print(f"  finish  : {summary['finish']}")
    print(f"  unknown : {summary['unknown']}")


if __name__ == "__main__":
    main()