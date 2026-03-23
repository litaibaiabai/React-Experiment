import cv2
from PIL import Image
import imagehash
import os

def filter_duplicate_frames(input_dir, threshold=10):
    """
    处理单个文件夹：删除相似冗余图片
    input_dir: 图片所在文件夹
    threshold: 汉明距离阈值，越小越严格
    """
    # 获取所有图片并按名称排序
    image_files = sorted([f for f in os.listdir(input_dir) 
                         if f.endswith(('.jpg', '.png', '.jpeg'))])
    
    if not image_files:
        return

    last_keep_hash = None
    kept_count = 0
    removed_count = 0

    for img_name in image_files:
        img_path = os.path.join(input_dir, img_name)
        
        try:
            current_hash = imagehash.phash(Image.open(img_path))
        except Exception as e:
            continue

        if last_keep_hash is None:
            # 保留第一张
            last_keep_hash = current_hash
            kept_count += 1
            continue

        distance = current_hash - last_keep_hash

        if distance < threshold:
            # 太相似，直接删除
            os.remove(img_path)
            removed_count += 1
        else:
            # 保留，更新基准
            last_keep_hash = current_hash
            kept_count += 1

    print(f"✅ 完成：{input_dir} | 保留：{kept_count} 张 | 删除冗余：{removed_count} 张")

def process_all_subfolders(root_dir="data", threshold=8):
    """
    递归遍历 data 下所有子目录，对每个目录执行去重
    """
    # 遍历根目录下所有文件夹
    for dirpath, dirnames, filenames in os.walk(root_dir):
        # 跳过根目录，只处理视频抽帧后的子文件夹
        if dirpath == root_dir:
            continue
            
        print(f"\n🔍 正在扫描文件夹：{dirpath}")
        filter_duplicate_frames(dirpath, threshold=threshold)

# ==================== 执行 ====================
if __name__ == "__main__":
    print("🚀 开始递归清理所有视频帧冗余图片...")
    process_all_subfolders(root_dir="data", threshold=8)
    print("\n🎉 所有子目录冗余文件已全部删除完成！")