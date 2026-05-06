const express = require("express");
const cors = require("cors");
const path = require("path");
const http = require("http");
const { registerExpRoutes } = require("./router/exp");
const { createExpService } = require("./services/expService");
const { createRtspWebSocketServer } = require("./services/wsService");

const app = express();

// 运行时配置：端口、推理服务地址、文件目录和抓拍开关等。
const HTTP_PORT = Number(process.env.HTTP_PORT || 3001);
const PYTHON_API = process.env.PYTHON_API || "http://127.0.0.1:3008/detect";
const PYTHON_LOAD_MODEL_API = process.env.PYTHON_LOAD_MODEL_API || "http://127.0.0.1:3008/load-model";
const MIN_CAPTURE_WIDTH = Number(process.env.MIN_CAPTURE_WIDTH || 640);
const MIN_CAPTURE_HEIGHT = Number(process.env.MIN_CAPTURE_HEIGHT || 360);
const CAPTURE_SAVE_INTERVAL_MS = Number(process.env.CAPTURE_SAVE_INTERVAL_MS || 1500);
const SCREENSHOT_ENABLED = String(process.env.SCREENSHOT_ENABLED || "1") !== "0";

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

const expService = createExpService({
  baseDir: __dirname,
  pythonApi: PYTHON_API,
  pythonLoadModelApi: PYTHON_LOAD_MODEL_API,
  minCaptureWidth: MIN_CAPTURE_WIDTH,
  minCaptureHeight: MIN_CAPTURE_HEIGHT,
  captureSaveIntervalMs: CAPTURE_SAVE_INTERVAL_MS,
  screenshotEnabled: SCREENSHOT_ENABLED
});

registerExpRoutes(app, expService);

const server = http.createServer(app);

// WebSocket 用于把 RTSP 流转成 FLV 二进制流推给前端。
createRtspWebSocketServer(server);

// 启动 HTTP 服务，并在启动后预加载默认实验模型。
server.listen(HTTP_PORT, async () => {
  console.log(`HTTP 后端服务器已启动，运行在端口 ${HTTP_PORT}`);
  console.log("WebSocket RTSP服务已启动，路径: /ws/rtsp");

  const experiment = expService.getExperiment();
  if (!experiment) {
    console.warn("未读取到实验配置，请检查 backend/experiments 目录");
    return;
  }

  try {
    await expService.preloadExperimentModel(experiment);
    console.log(`默认实验模型已加载: ${experiment.displayName}`);
  } catch (error) {
    console.warn(`默认实验模型预加载失败: ${error.message}`);
  }
});
