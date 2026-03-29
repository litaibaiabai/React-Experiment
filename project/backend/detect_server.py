# from fastapi import FastAPI, UploadFile, File, Form
# from fastapi.responses import JSONResponse
# from ultralytics import YOLO
# from PIL import Image
# import io

# app = FastAPI()

# MODEL_PATH = "best.pt"
# model = YOLO(MODEL_PATH)

# CLASS_NAMES = [
#     "wire",
#     "battery",
#     "switch",
#     "batteryComp",
#     "lightbulb",
#     "lightbulbModel",
#     "switchConnected",
#     "batteryConnected",
#     "lightbulbConnected",
#     "lightbulbOrange",
#     "switchClosed"
# ]

# @app.get("/health")
# def health():
#     return {"ok": True, "model": MODEL_PATH}

# @app.post("/detect")
# async def detect(
#     image: UploadFile = File(...),
#     conf: float = Form(0.25)
# ):
#     try:
#         content = await image.read()
#         pil_image = Image.open(io.BytesIO(content)).convert("RGB")

#         results = model.predict(
#             source=pil_image,
#             conf=conf,
#             imgsz=640,
#             verbose=False
#         )

#         result = results[0]
#         boxes = []

#         if result.boxes is not None:
#             xyxy = result.boxes.xyxy.cpu().numpy()
#             cls = result.boxes.cls.cpu().numpy()
#             scores = result.boxes.conf.cpu().numpy()

#             for i in range(len(xyxy)):
#                 x1, y1, x2, y2 = xyxy[i].tolist()
#                 class_id = int(cls[i])
#                 score = float(scores[i])

#                 class_name = (
#                     CLASS_NAMES[class_id]
#                     if 0 <= class_id < len(CLASS_NAMES)
#                     else f"class_{class_id}"
#                 )

#                 boxes.append({
#                     "x1": x1,
#                     "y1": y1,
#                     "x2": x2,
#                     "y2": y2,
#                     "score": score,
#                     "classId": class_id,
#                     "className": class_name
#                 })

#         return {
#             "code": 0,
#             "msg": "success",
#             "boxes": boxes
#         }

#     except Exception as e:
#         return JSONResponse(
#             status_code=500,
#             content={
#                 "code": 500,
#                 "msg": "detect failed",
#                 "detail": str(e)
#             }
#         )


from fastapi import FastAPI, UploadFile, File, Form
from fastapi.responses import JSONResponse
from ultralytics import YOLO
from PIL import Image
import io
import uvicorn

app = FastAPI()

MODEL_PATH = "best.pt"
model = YOLO(MODEL_PATH)

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
    "switchClosed"
]

@app.get("/health")
def health():
    return {"ok": True, "model": MODEL_PATH}

@app.post("/detect")
async def detect(
    image: UploadFile = File(...),
    # 把默认置信度也写死在这里
    conf: float = Form(0.25)
):
    try:
        content = await image.read()
        pil_image = Image.open(io.BytesIO(content)).convert("RGB")

        results = model.predict(
            source=pil_image,
            conf=conf,
            imgsz=640,
            verbose=False
        )

        result = results[0]
        boxes = []

        if result.boxes is not None:
            xyxy = result.boxes.xyxy.cpu().numpy()
            cls = result.boxes.cls.cpu().numpy()
            scores = result.boxes.conf.cpu().numpy()

            for i in range(len(xyxy)):
                x1, y1, x2, y2 = xyxy[i].tolist()
                class_id = int(cls[i])
                score = float(scores[i])

                class_name = (
                    CLASS_NAMES[class_id]
                    if 0 <= class_id < len(CLASS_NAMES)
                    else f"class_{class_id}"
                )

                boxes.append({
                    "x1": x1,
                    "y1": y1,
                    "x2": x2,
                    "y2": y2,
                    "score": score,
                    "classId": class_id,
                    "className": class_name
                })

        return {
            "code": 0,
            "msg": "success",
            "boxes": boxes
        }

    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={
                "code": 500,
                "msg": "detect failed",
                "detail": str(e)
            }
        )

# ==============================================
# 所有启动配置直接写在这里
# 端口：9000
# 地址：0.0.0.0
# 热重载：开启
# ==============================================
if __name__ == "__main__":
    uvicorn.run(
        "detect_server:app",
        host="0.0.0.0",
        port=3000,
        reload=True
    )