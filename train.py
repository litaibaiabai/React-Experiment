from ultralytics import YOLO

def main():
    model = YOLO("yolo26n.pt")
    model.train(
        data="./dataset/data.yaml",
        epochs=120,
        imgsz=960,
        batch=16,
        device="cpu",
        workers=4,
        patience=30,
        pretrained=True,
        project="runs/train",
        name="yolo26_exp"
    )
if __name__ == "__main__":
    main()
