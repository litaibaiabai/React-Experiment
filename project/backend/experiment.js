const express = require("express");
const cors = require("cors");
const path = require("path");
const http = require("http");
const multer = require("multer");
const axios = require("axios");
const FormData = require("form-data");
const WebSocket = require("ws");
const ffmpeg = require("fluent-ffmpeg");
const url = require("url");

const app = express();

const HTTP_PORT = 80;
const PYTHON_API = "http://127.0.0.1:3000/detect";

// 兼容 FFmpeg 路径
const ffmpegPath =
  process.env.FFMPEG_PATH ||
  "/opt/homebrew/bin/ffmpeg";

ffmpeg.setFfmpegPath(ffmpegPath);

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 3 * 1024 * 1024
  }
});

// 前端调用这个接口
app.post("/api/detect", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        code: 400,
        msg: "缺少图片文件 image",
        data: null
      });
    }

    const form = new FormData();
    form.append("image", req.file.buffer, {
      filename: req.file.originalname || "frame.jpg",
      contentType: req.file.mimetype || "image/jpeg"
    });
    form.append("conf", req.body.conf || "0.25");

    const response = await axios.post(PYTHON_API, form, {
      headers: form.getHeaders(),
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      timeout: 15000
    });

    return res.json(response.data);
  } catch (err) {
    console.error("调用推理服务失败:", err.message);
    return res.status(500).json({
      code: 500,
      msg: "调用推理服务失败",
      detail: err.message
    });
  }
});

app.use((req, res) => {
  res.status(404).json({
    code: 404,
    msg: "请求的资源不存在",
    data: null
  });
});

app.use((err, req, res, next) => {
  console.error("全局错误:", err);
  res.status(500).json({
    code: 500,
    msg: "服务器内部错误",
    data: null
  });
});

// 创建 HTTP 服务器
const server = http.createServer(app);

// 创建 WebSocket 服务器
const wss = new WebSocket.Server({
  server,
  path: "/ws/rtsp",
  perMessageDeflate: false
});

/**
 * 创建 RTSP -> FLV(H264) 转码任务
 */
function createRtspFlvStream(rtspUrl, ws) {
  const command = ffmpeg(rtspUrl)
    .inputOptions([
      "-rtsp_transport tcp",
      "-rtsp_flags prefer_tcp",
      "-fflags nobuffer",
      "-flags low_delay",
      "-avioflags direct",
      "-analyzeduration 0",
      "-probesize 1024",
      "-fpsprobesize 0",
      "-max_delay 0",
      "-timeout 5000000",
      "-use_wallclock_as_timestamps 1"
    ])
    .videoCodec("libx264")
    .noAudio()
    .videoFilters("scale=1920:-1:flags=lanczos")
    .outputOptions([
      "-f flv",
      "-pix_fmt yuv420p",
      "-preset veryfast",
      "-tune zerolatency",
      "-profile:v baseline",
      "-level 3.0",
      "-g 25",
      "-keyint_min 25",
      "-sc_threshold 0",
      "-bf 0",
      "-refs 1",
      "-r 25",
      "-crf 20",
      "-maxrate 5000k",
      "-bufsize 5000k",
      "-flush_packets 1"
    ])
    .on("start", (commandLine) => {
      console.log("FFmpeg启动:", commandLine);
    })
    .on("stderr", (line) => {
      console.log("FFmpeg日志:", line);
    })
    .on("error", (err) => {
      console.error("FFmpeg错误:", err.message);
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({
            type: "error",
            message: `FFmpeg错误: ${err.message}`
          }));
        } catch (_) {}
      }
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    })
    .on("end", () => {
      console.log("FFmpeg结束");
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    });

  const ffmpegStream = command.pipe();

  ffmpegStream.on("data", (chunk) => {
    if (ws.readyState !== WebSocket.OPEN) {
      safeKill(command);
      return;
    }

    // 避免客户端堵塞导致延时越积越大
    if (ws.bufferedAmount > 1024 * 1024) {
      return;
    }

    ws.send(chunk, { binary: true }, (err) => {
      if (err) {
        console.error("WebSocket发送失败:", err.message);
        safeKill(command);
      }
    });
  });

  ffmpegStream.on("error", (err) => {
    console.error("输出流错误:", err.message);
    safeKill(command);
    if (ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
  });

  return command;
}

function safeKill(command) {
  try {
    command.kill("SIGKILL");
  } catch (e) {
    try {
      command.kill();
    } catch (_) {}
  }
}

wss.on("connection", (ws, req) => {
  console.log("WebSocket客户端连接");

  const params = url.parse(req.url, true);
  const rtspUrl = params.query.rtsp_url;

  if (!rtspUrl) {
    ws.send(JSON.stringify({ type: "error", message: "缺少 rtsp_url 参数" }));
    ws.close();
    return;
  }

  console.log(`开始处理 RTSP 流: ${rtspUrl}`);

  // 可选：先发一个握手消息，前端可据此判断这是 FLV 流
  try {
    ws.send(JSON.stringify({ type: "start", format: "flv", codec: "h264" }));
  } catch (_) {}

  const ffmpegCommand = createRtspFlvStream(rtspUrl, ws);

  ws.on("close", () => {
    console.log("WebSocket客户端断开连接");
    safeKill(ffmpegCommand);
  });

  ws.on("error", (error) => {
    console.error("WebSocket错误:", error.message);
    safeKill(ffmpegCommand);
  });

  ws.on("message", (msg) => {
    // 这里预留给前端控制指令，比如 pause / resume / snapshot
    // 当前版本不处理
    // console.log("收到客户端消息:", msg.toString());
  });
});

server.listen(HTTP_PORT, () => {
  console.log(`HTTP 后端服务器已启动，运行在端口 ${HTTP_PORT}`);
  console.log(`WebSocket RTSP服务已启动，路径: /ws/rtsp`);
});