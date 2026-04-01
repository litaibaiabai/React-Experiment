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
const fs = require("fs");

const app = express();

const HTTP_PORT = Number(process.env.HTTP_PORT || 3001);
const PYTHON_API = process.env.PYTHON_API || "http://127.0.0.1:3000/detect";
const PYTHON_LOAD_MODEL_API = process.env.PYTHON_LOAD_MODEL_API || "http://127.0.0.1:3000/load-model";
const EXPERIMENT_DIR = path.join(__dirname, "experiments");
const CAMERA_CONFIG_PATH = path.join(__dirname, "cameras.json");

const ffmpegPath = process.env.FFMPEG_PATH || "/opt/homebrew/bin/ffmpeg";

ffmpeg.setFfmpegPath(ffmpegPath);

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 6 * 1024 * 1024
  }
});

function readExperiments() {
  if (!fs.existsSync(EXPERIMENT_DIR)) {
    return {};
  }

  const files = fs
    .readdirSync(EXPERIMENT_DIR)
    .filter((fileName) => fileName.endsWith(".json"));

  return files.reduce((accumulator, fileName) => {
    const filePath = path.join(EXPERIMENT_DIR, fileName);
    const experimentKey = path.basename(fileName, ".json");
    const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));

    accumulator[experimentKey] = {
      key: experimentKey,
      filePath,
      ...raw,
      modelPath: path.resolve(__dirname, raw.modelPath)
    };

    return accumulator;
  }, {});
}

function readCameraConfig() {
  const base = Array.from({ length: 12 }, (_, index) => ({
    id: `camera-${index + 1}`,
    name: `摄像头 ${index + 1}`,
    rtspUrl: "",
    slot: index + 1
  }));

  if (!fs.existsSync(CAMERA_CONFIG_PATH)) {
    return base;
  }

  const raw = JSON.parse(fs.readFileSync(CAMERA_CONFIG_PATH, "utf-8"));
  const cameras = Array.isArray(raw?.cameras) ? raw.cameras : [];

  return base.map((camera, index) => ({
    ...camera,
    ...(cameras[index] || {})
  }));
}

let experiments = readExperiments();
let activeExperimentKey =
  Object.keys(experiments).find((key) => experiments[key].isDefault) ||
  Object.keys(experiments)[0] ||
  null;

function getExperiment(experimentKey = activeExperimentKey) {
  if (!experimentKey) {
    return null;
  }

  return experiments[experimentKey] || null;
}

function serializeExperiment(experiment) {
  if (!experiment) {
    return null;
  }

  return {
    key: experiment.key,
    displayName: experiment.displayName,
    description: experiment.description || "",
    modelFile: path.basename(experiment.modelPath),
    classNames: experiment.classNames || [],
    stateRules: experiment.stateRules || {},
    scoreRules: experiment.scoreRules || []
  };
}

async function preloadExperimentModel(experiment) {
  if (!experiment) {
    throw new Error("实验配置不存在");
  }

  await axios.post(
    PYTHON_LOAD_MODEL_API,
    {
      model_path: experiment.modelPath,
      class_names: experiment.classNames || []
    },
    {
      timeout: 30000
    }
  );
}

function buildClassCounts(boxes = []) {
  return boxes.reduce((accumulator, box) => {
    const className = box.className;
    if (!className) {
      return accumulator;
    }

    accumulator[className] = (accumulator[className] || 0) + 1;
    return accumulator;
  }, {});
}

function scoreExperiment(experiment, classCounts = {}) {
  const stateRules = experiment?.stateRules || {};
  const scoreRules = experiment?.scoreRules || [];

  const stateResults = scoreRules.map((rule) => {
    const requirements = Object.entries(stateRules[rule.state] || {}).map(([className, required]) => {
      const actual = classCounts[className] || 0;
      return {
        className,
        required,
        actual,
        passed: actual >= required
      };
    });

    const passed = requirements.every((item) => item.passed);

    return {
      state: rule.state,
      score: rule.score,
      earnedScore: passed ? rule.score : 0,
      passed,
      requirements
    };
  });

  const totalScore = stateResults.reduce((sum, item) => sum + item.earnedScore, 0);

  return {
    totalScore,
    maxScore: scoreRules.reduce((sum, item) => sum + item.score, 0),
    completedStates: stateResults.filter((item) => item.passed).map((item) => item.state),
    currentState: stateResults.find((item) => !item.passed)?.state || "finish",
    stateResults
  };
}

function normalizeCameraList(cameras = []) {
  const base = readCameraConfig();

  return base.map((camera, index) => ({
    ...camera,
    ...(cameras[index] || {})
  }));
}

async function detectByBuffer(imageBuffer, experiment, conf = 0.25) {
  const form = new FormData();
  form.append("image", imageBuffer, {
    filename: "frame.jpg",
    contentType: "image/jpeg"
  });
  form.append("conf", String(conf));
  form.append("model_path", experiment.modelPath);
  form.append("class_names", JSON.stringify(experiment.classNames || []));

  const response = await axios.post(PYTHON_API, form, {
    headers: form.getHeaders(),
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    timeout: 30000
  });

  return response.data;
}

function captureRtspFrame(rtspUrl) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let settled = false;

    const settleResolve = (buffer) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(buffer);
    };

    const settleReject = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      reject(error);
    };

    const command = ffmpeg(rtspUrl)
      .inputOptions([
        "-rtsp_transport tcp",
        "-rtsp_flags prefer_tcp",
        "-rw_timeout 10000000",
        "-timeout 10000000",
        "-fflags nobuffer",
        "-flags low_delay",
        "-analyzeduration 1000000",
        "-probesize 32768"
      ])
      .noAudio()
      .format("image2pipe")
      .outputOptions(["-frames:v 1", "-f image2", "-vcodec mjpeg", "-q:v 2"])
      .on("error", (error) => {
        settleReject(error);
      });

    const timer = setTimeout(() => {
      safeKill(command);
      settleReject(new Error("RTSP 截图超时"));
    }, 12000);

    const stream = command.pipe();

    stream.on("data", (chunk) => {
      chunks.push(chunk);
    });

    stream.on("end", () => {
      if (!chunks.length) {
        settleReject(new Error("RTSP 未返回有效图像帧"));
        return;
      }
      settleResolve(Buffer.concat(chunks));
    });

    stream.on("close", () => {
      if (!chunks.length || settled) {
        return;
      }
      settleResolve(Buffer.concat(chunks));
    });

    stream.on("error", (error) => {
      settleReject(error);
    });
  });
}

async function analyzeOneCamera(camera, experiment, conf) {
  if (!camera.rtspUrl) {
    return {
      ...camera,
      online: false,
      error: "未配置 RTSP 地址",
      boxes: [],
      classCounts: {},
      stateResults: [],
      totalScore: 0,
      maxScore: scoreExperiment(experiment, {}).maxScore,
      snapshotBase64: null
    };
  }

  const frameBuffer = await captureRtspFrame(camera.rtspUrl);
  const detectResult = await detectByBuffer(frameBuffer, experiment, conf);
  const boxes = detectResult.boxes || [];
  const classCounts = buildClassCounts(boxes);
  const scoreResult = scoreExperiment(experiment, classCounts);

  return {
    ...camera,
    online: true,
    error: null,
    boxes,
    classCounts,
    snapshotBase64: frameBuffer.toString("base64"),
    ...scoreResult
  };
}

app.get("/api/experiments", async (req, res) => {
  try {
    experiments = readExperiments();

    if (!activeExperimentKey || !experiments[activeExperimentKey]) {
      activeExperimentKey =
        Object.keys(experiments).find((key) => experiments[key].isDefault) ||
        Object.keys(experiments)[0] ||
        null;
    }

    return res.json({
      code: 0,
      msg: "success",
      data: {
        activeExperimentKey,
        cameras: readCameraConfig(),
        experiments: Object.values(experiments).map(serializeExperiment)
      }
    });
  } catch (error) {
    return res.status(500).json({
      code: 500,
      msg: "读取实验配置失败",
      detail: error.message
    });
  }
});

app.get("/api/cameras", (req, res) => {
  return res.json({
    code: 0,
    msg: "success",
    data: {
      cameras: readCameraConfig()
    }
  });
});

app.post("/api/experiments/select", async (req, res) => {
  try {
    const { experimentKey } = req.body || {};
    const experiment = getExperiment(experimentKey);

    if (!experiment) {
      return res.status(404).json({
        code: 404,
        msg: "实验不存在"
      });
    }

    await preloadExperimentModel(experiment);
    activeExperimentKey = experiment.key;

    return res.json({
      code: 0,
      msg: "success",
      data: {
        activeExperimentKey,
        experiment: serializeExperiment(experiment)
      }
    });
  } catch (error) {
    return res.status(500).json({
      code: 500,
      msg: "加载实验模型失败",
      detail: error.message
    });
  }
});

app.get("/api/experiments/active", (req, res) => {
  return res.json({
    code: 0,
    msg: "success",
    data: {
      activeExperimentKey,
      experiment: serializeExperiment(getExperiment())
    }
  });
});

app.post("/api/analyze-cameras", async (req, res) => {
  try {
    const { experimentKey, cameras = [], conf = 0.25 } = req.body || {};
    const experiment = getExperiment(experimentKey);

    if (!experiment) {
      return res.status(404).json({
        code: 404,
        msg: "未找到实验配置"
      });
    }

    const normalizedCameras = normalizeCameraList(cameras);
    const results = await Promise.all(
      normalizedCameras.map(async (camera) => {
        try {
          return await Promise.race([
            analyzeOneCamera(camera, experiment, conf),
            new Promise((_, reject) => {
              setTimeout(() => reject(new Error("单路识别超时")), 15000);
            })
          ]);
        } catch (error) {
          return {
            ...camera,
            online: false,
            error: error.message,
            boxes: [],
            classCounts: {},
            stateResults: [],
            totalScore: 0,
            maxScore: scoreExperiment(experiment, {}).maxScore,
            snapshotBase64: null
          };
        }
      })
    );

    return res.json({
      code: 0,
      msg: "success",
      data: {
        experiment: serializeExperiment(experiment),
        cameras: results,
        summary: {
          totalScore: results.reduce((sum, item) => sum + item.totalScore, 0),
          maxScore: results.reduce((sum, item) => sum + item.maxScore, 0),
          onlineCount: results.filter((item) => item.online).length
        }
      }
    });
  } catch (error) {
    return res.status(500).json({
      code: 500,
      msg: "批量识别失败",
      detail: error.message
    });
  }
});

app.post("/api/detect", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        code: 400,
        msg: "缺少图片文件 image",
        data: null
      });
    }

    const experiment = getExperiment(req.body.experimentKey);

    if (!experiment) {
      return res.status(404).json({
        code: 404,
        msg: "实验不存在"
      });
    }

    const response = await detectByBuffer(req.file.buffer, experiment, req.body.conf || "0.25");
    const classCounts = buildClassCounts(response.boxes || []);
    const scoreResult = scoreExperiment(experiment, classCounts);

    return res.json({
      ...response,
      experiment: serializeExperiment(experiment),
      classCounts,
      ...scoreResult
    });
  } catch (err) {
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

const server = http.createServer(app);

const wss = new WebSocket.Server({
  server,
  path: "/ws/rtsp",
  perMessageDeflate: false
});

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
    .on("error", (err) => {
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

    if (ws.bufferedAmount > 1024 * 1024) {
      return;
    }

    ws.send(chunk, { binary: true }, (err) => {
      if (err) {
        safeKill(command);
      }
    });
  });

  ffmpegStream.on("error", () => {
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
  } catch (error) {
    try {
      command.kill();
    } catch (_) {}
  }
}

wss.on("connection", (ws, req) => {
  const params = url.parse(req.url, true);
  const rtspUrl = params.query.rtsp_url;

  if (!rtspUrl) {
    ws.send(JSON.stringify({ type: "error", message: "缺少 rtsp_url 参数" }));
    ws.close();
    return;
  }

  try {
    ws.send(JSON.stringify({ type: "start", format: "flv", codec: "h264" }));
  } catch (_) {}

  const ffmpegCommand = createRtspFlvStream(rtspUrl, ws);

  ws.on("close", () => {
    safeKill(ffmpegCommand);
  });

  ws.on("error", () => {
    safeKill(ffmpegCommand);
  });
});

server.listen(HTTP_PORT, async () => {
  console.log(`HTTP 后端服务器已启动，运行在端口 ${HTTP_PORT}`);
  console.log("WebSocket RTSP服务已启动，路径: /ws/rtsp");

  const experiment = getExperiment();
  if (!experiment) {
    console.warn("未读取到实验配置，请检查 backend/experiments 目录");
    return;
  }

  try {
    await preloadExperimentModel(experiment);
    console.log(`默认实验模型已加载: ${experiment.displayName}`);
  } catch (error) {
    console.warn(`默认实验模型预加载失败: ${error.message}`);
  }
});
