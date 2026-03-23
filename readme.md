scp /Users/quanta/Documents/Demo/ExpGrade/new.zip root@108.160.134.43:/root
scp root@108.160.134.43:/root/new/runs.zip /Users/quanta/Downloads


ssh root@108.160.134.43


5v{WT@{CnYVDg?zP




sudo apt update && sudo apt upgrade -y
sudo apt install python3 python3-pip -y
sudo apt install python3.12 python3.12-venv python3.12-dev  python3-pip git -y 
apt install python3.12-venv
python3 -m venv yolov8_env
source yolov8_env/bin/activate
pip install ultralytics 




yolo detect train data=dataset/dataset.yaml model=yolo11n.pt imgsz=960 epochs=150 batch=8


yolo detect train \
  data=dataset/dataset.yaml \
  model=yolo11n.pt \
  imgsz=1024 \
  epochs=150 \
  batch=4 \
  project=runs/detect \
  name=exp_final_v1


../../myenv/bin/python -m uvicorn detect_server:app --host 0.0.0.0 --port 8000 --reload