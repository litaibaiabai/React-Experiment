from fastapi import FastAPI, UploadFile, File, Form
from fastapi.responses import JSONResponse
from ultralytics import YOLO
from PIL import Image
import io
import uvicorn
import json
import os

app = FastAPI()
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

MODEL_CACHE = {}
CURRENT_MODEL_PATH = None
CURRENT_CLASS_NAMES = []


def load_model(model_path: str, class_names=None):
    global CURRENT_MODEL_PATH
    global CURRENT_CLASS_NAMES

    normalized_path = os.path.abspath(model_path)

    if normalized_path not in MODEL_CACHE:
        MODEL_CACHE[normalized_path] = YOLO(normalized_path)

    CURRENT_MODEL_PATH = normalized_path
    CURRENT_CLASS_NAMES = class_names or []
    return MODEL_CACHE[normalized_path]


DEFAULT_MODEL_PATH = os.path.abspath(os.path.join(BASE_DIR, os.environ.get("MODEL_PATH", "best-el.pt")))
model = load_model(DEFAULT_MODEL_PATH)

@app.get("/health")
def health():
    return {"ok": True, "model": CURRENT_MODEL_PATH}


@app.post("/load-model")
async def switch_model(payload: dict):
    try:
        model_path = payload.get("model_path")
        class_names = payload.get("class_names", [])

        if not model_path:
            return JSONResponse(
                status_code=400,
                content={"code": 400, "msg": "model_path is required"}
            )

        load_model(model_path, class_names)
        return {
            "code": 0,
            "msg": "success",
            "data": {
                "modelPath": CURRENT_MODEL_PATH,
                "classNames": CURRENT_CLASS_NAMES
            }
        }
    except Exception as error:
        return JSONResponse(
            status_code=500,
            content={"code": 500, "msg": "load model failed", "detail": str(error)}
        )

@app.post("/detect")
async def detect(
    image: UploadFile = File(...),
    conf: float = Form(0.25),
    model_path: str = Form(None),
    class_names: str = Form("[]")
):
    try:
        resolved_class_names = json.loads(class_names) if class_names else []
        active_model = model

        if model_path:
            active_model = load_model(model_path, resolved_class_names)
        elif resolved_class_names:
            load_model(CURRENT_MODEL_PATH, resolved_class_names)

        content = await image.read()
        pil_image = Image.open(io.BytesIO(content)).convert("RGB")

        results = active_model.predict(
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

                if 0 <= class_id < len(CURRENT_CLASS_NAMES):
                    class_name = CURRENT_CLASS_NAMES[class_id]
                else:
                    model_names = getattr(active_model, "names", {})
                    if isinstance(model_names, dict):
                        class_name = model_names.get(class_id, f"class_{class_id}")
                    elif isinstance(model_names, list) and 0 <= class_id < len(model_names):
                        class_name = model_names[class_id]
                    else:
                        class_name = f"class_{class_id}"

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
            "boxes": boxes,
            "modelPath": CURRENT_MODEL_PATH
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
