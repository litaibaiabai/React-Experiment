import os
import json
from datetime import datetime

def count_yolo_classes(folder_path):
    """
    统计 YOLO 标注文件夹中每个类别的数量
    """
    class_count = {}
    total_files = 0
    total_annotations = 0
    
    def traverse_directory(dir_path):
        nonlocal total_files, total_annotations
        try:
            for item in os.listdir(dir_path):
                full_path = os.path.join(dir_path, item)
                if os.path.isdir(full_path):
                    traverse_directory(full_path)
                elif os.path.isfile(full_path) and item.lower().endswith('.txt'):
                    process_annotation_file(full_path)
        except Exception as e:
            print(f'读取文件夹错误：{dir_path}', str(e))
    
    def process_annotation_file(file_path):
        nonlocal total_files, total_annotations
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read()
            lines = [line for line in content.split('\n') if line.strip()]
            
            if lines:
                total_files += 1
                total_annotations += len(lines)
                
                for line in lines:
                    parts = line.strip().split()
                    if len(parts) >= 5:
                        class_id = parts[0]
                        class_count[class_id] = class_count.get(class_id, 0) + 1
        except Exception as e:
            print(f'处理文件错误：{file_path}', str(e))
    
    if not os.path.exists(folder_path):
        raise FileNotFoundError(f'文件夹不存在：{folder_path}')
    
    print(f'开始统计 YOLO 标注文件：{folder_path}')
    print('=' * 50)
    
    traverse_directory(folder_path)
    
    return {
        'classCount': class_count,
        'totalFiles': total_files,
        'totalAnnotations': total_annotations,
        'uniqueClasses': len(class_count)
    }

def print_statistics(result):
    """格式化输出统计结果"""
    class_count = result['classCount']
    total_files = result['totalFiles']
    total_annotations = result['totalAnnotations']
    unique_classes = result['uniqueClasses']
    
    print(f'处理标注文件：{total_files}个')
    print(f'总标注框数量：{total_annotations}个')
    print(f'唯一类别数量：{unique_classes}个')
    print('=' * 50)
    
    sorted_classes = sorted(class_count.keys(), key=lambda x: int(x))
    
    for class_id in sorted_classes:
        print(f'类别 {class_id}: {class_count[class_id]} 个标注框')
    
    print('-' * 30)

def save_statistics_to_file(result, output_path):
    """保存统计结果到文件"""
    try:
        output = {
            'timestamp': datetime.now().isoformat(),
            'statistics': result
        }
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(output, f, indent=2, ensure_ascii=False)
        print(f'\n统计结果已保存到：{output_path}')
    except Exception as e:
        print('保存文件错误:', str(e))

def main():
    folder_path = './dataset'
    output_file = './class_statistics.json'
    
    try:
        result = count_yolo_classes(folder_path)
        print_statistics(result)
        save_statistics_to_file(result, output_file)
    except Exception as e:
        print('程序执行错误:', str(e))

if __name__ == '__main__':
    main()
