scp /Users/quanta/Documents/Demo/ExpGrade/project/dataset.zip root@207.148.112.160:/root
scp root@207.148.112.160:/root/runs.zip /Users/quanta/Downloads


ssh root@207.148.112.160


iS2*Fvynk6bux!S.


http://runzhixin.xyz/dataset.zip

sudo apt update && sudo apt upgrade -y
sudo apt install python3 python3-pip -y
sudo apt install python3.12 python3.12-venv python3.12-dev  python3-pip git -y 
apt install python3.12-venv
python3 -m venv yolov8_env
source yolov8_env/bin/activate
pip install ultralytics opencv-python pycocotools 
apt install nvidia-cuda-toolkit
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu124




yolo detect train data=dataset/dataset.yaml model=yolo11n.pt imgsz=960 epochs=150 batch=8


yolo detect train \
  data=dataset/dataset.yaml \
  model=yolo11n.pt \
  imgsz=1024 \
  epochs=150 \
  batch=8 \
  workers=4 \
  project=runs/detect \
  name=exp_final_v1



yolo detect train \
  data=dataset/dataset.yaml \
  model=yolo11s.pt \
  imgsz=1024 \
  epochs=150 \
  batch=8 \
  device=0 \
  workers=1 \
  cache=ram \
  deterministic=False \
  plots=False \
  project=runs/detect \
  name=exp_1024_11s

yolo detect train data=dataset/dataset.yaml model=yolo11s.pt imgsz=1152 epochs=150 batch=8  cache=ram project=runs/detect name=exp_1152_11s


../../myenv/bin/python -m uvicorn detect_server:app --host 0.0.0.0 --port 9000 --reload






yolo detect train \
  data=dataset/dataset.yaml \
  model=yolo11n.pt \
  imgsz=512 \
  epochs=120 \
  batch=32 \
  device=mps \
  cache=ram \
  workers=0 \
  amp=True \
  max_det=100 \
  augment=True \
  hsv_h=0.015 \
  hsv_s=0.7 \
  hsv_v=0.4 \
  fliplr=0.5 \
  translate=0.1 \
  scale=0.5 \
  close_mosaic=10 \
  cos_lr=False \
  patience=30 \
  plots=False \
  deterministic=False \
  name=exp_final
