#!/bin/bash

# 遍历 data 下所有 mov 和 mp4 文件（不区分大小写）
shopt -s nullglob  # 防止没有匹配文件时报错
for file in data/*.{mov,MOV,mp4,MP4}; do
    # 获取不带路径和后缀的文件名
    filename="${file%.*}"
    filename=$(basename "$filename")

    # 创建输出文件夹
    mkdir -p "data/$filename"

    # ffmpeg 每秒拆一帧图片
    ffmpeg -i "$file" -r 1 -qscale:v 1 "data/$filename/image_%04d.jpg" -hide_banner -loglevel error

    echo "已处理：$file"
done

echo -e "\n所有视频拆帧完成！"