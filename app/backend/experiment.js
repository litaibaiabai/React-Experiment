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
const PYTHON_API = process.env.PYTHON_API || "http://127.0.0.1:3008/detect";
const PYTHON_LOAD_MODEL_API = process.env.PYTHON_LOAD_MODEL_API || "http://127.0.0.1:3008/load-model";
const EXPERIMENT_DIR = path.join(__dirname, "experiments");
const CAMERA_CONFIG_PATH = path.join(__dirname, "cameras.json");
const RESULT_DIR = path.join(__dirname, "results");
const RESULT_LATEST_FILE = path.join(RESULT_DIR, "latest.json");
const RESULT_HISTORY_FILE = path.join(RESULT_DIR, "history.jsonl");
const CAPTURE_DIR = path.join(__dirname, "capture");
const MIN_CAPTURE_WIDTH = Number(process.env.MIN_CAPTURE_WIDTH || 640);
const MIN_CAPTURE_HEIGHT = Number(process.env.MIN_CAPTURE_HEIGHT || 360);
const CAPTURE_SAVE_INTERVAL_MS = Number(process.env.CAPTURE_SAVE_INTERVAL_MS || 1500);
const cameraLastCaptureSaveAt = new Map();
const cumulativeScoreMemory = new Map();
let screenshotEnabled = String(process.env.SCREENSHOT_ENABLED || "1") !== "0";

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

  const files = fs.readdirSync(EXPERIMENT_DIR).filter((fileName) => fileName.endsWith(".json"));

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
    slot: index + 1,
    whitelist: false
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
  Object.keys(experiments).find((key) => experiments[key].isDefault) || Object.keys(experiments)[0] || null;

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

  const parseAlternativeClassNames = (rawKey) => {
    return String(rawKey || "")
      .split(/[|｜]/)
      .map((item) => item.trim())
      .filter(Boolean);
  };

  const stateResults = scoreRules.map((rule) => {
    const requirements = Object.entries(stateRules[rule.state] || {}).map(([classKey, required]) => {
      const alternatives = parseAlternativeClassNames(classKey);
      const actualList = alternatives.map((name) => ({
        className: name,
        actual: classCounts[name] || 0
      }));
      const bestMatched = actualList.reduce((best, current) => (current.actual > best.actual ? current : best), {
        className: alternatives[0] || classKey,
        actual: 0
      }) || { className: classKey, actual: 0 };
      const passed = actualList.some((item) => item.actual >= required);

      return {
        className: classKey,
        alternatives,
        required,
        actual: bestMatched.actual,
        matchedClassName: bestMatched.className,
        passed
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

function getCumulativeScoreKey(experimentKey, cameraId) {
  return `${experimentKey || "default"}::${cameraId || "camera"}`;
}

function getCumulativeScoreSnapshot(experimentKey, cameraId, experiment) {
  const key = getCumulativeScoreKey(experimentKey, cameraId);
  if (cumulativeScoreMemory.has(key)) {
    return cumulativeScoreMemory.get(key);
  }
  return scoreExperiment(experiment, {});
}

function applyCumulativeScore(experimentKey, cameraId, experiment, currentScoreResult) {
  const key = getCumulativeScoreKey(experimentKey, cameraId);
  const previous = cumulativeScoreMemory.get(key);
  const previousPassedMap = (previous?.stateResults || []).reduce((acc, state) => {
    acc[state.state] = Boolean(state.passed);
    return acc;
  }, {});
  const currentMap = (currentScoreResult?.stateResults || []).reduce((acc, state) => {
    acc[state.state] = state;
    return acc;
  }, {});
  const scoreRuleMap = (experiment?.scoreRules || []).reduce((acc, rule) => {
    acc[rule.state] = Number(rule.score || 0);
    return acc;
  }, {});

  const stateResults = (experiment?.scoreRules || []).map((rule) => {
    const stateName = rule.state;
    const currentState = currentMap[stateName] || {
      state: stateName,
      score: Number(rule.score || 0),
      earnedScore: 0,
      passed: false,
      requirements: []
    };
    const cumulativePassed = Boolean(previousPassedMap[stateName] || currentState.passed);
    return {
      ...currentState,
      score: Number(rule.score || currentState.score || 0),
      passed: cumulativePassed,
      earnedScore: cumulativePassed ? Number(scoreRuleMap[stateName] || 0) : 0
    };
  });

  const merged = {
    totalScore: stateResults.reduce((sum, state) => sum + Number(state.earnedScore || 0), 0),
    maxScore: (experiment?.scoreRules || []).reduce((sum, rule) => sum + Number(rule.score || 0), 0),
    completedStates: stateResults.filter((state) => state.passed).map((state) => state.state),
    currentState: stateResults.find((state) => !state.passed)?.state || "finish",
    stateResults
  };

  cumulativeScoreMemory.set(key, merged);
  return merged;
}

function normalizeCameraList(cameras = []) {
  const base = readCameraConfig();

  return base.map((camera, index) => ({
    ...camera,
    ...(cameras[index] || {})
  }));
}

function simplifyCameraResult(camera) {
  return {
    id: camera.id,
    name: camera.name,
    slot: camera.slot,
    rtspUrl: camera.rtspUrl || "",
    online: Boolean(camera.online),
    error: camera.error || null,
    resolutionCheck: camera.resolutionCheck || null,
    totalScore: Number(camera.totalScore || 0),
    maxScore: Number(camera.maxScore || 0),
    completedStates: Array.isArray(camera.completedStates) ? camera.completedStates : [],
    currentState: camera.currentState || null,
    stateResults: Array.isArray(camera.stateResults)
      ? camera.stateResults.map((state) => ({
          state: state.state,
          score: Number(state.score || 0),
          earnedScore: Number(state.earnedScore || 0),
          passed: Boolean(state.passed)
        }))
      : []
  };
}

async function persistResultRecord(record) {
  try {
    await fs.promises.mkdir(RESULT_DIR, { recursive: true });
    await fs.promises.writeFile(RESULT_LATEST_FILE, JSON.stringify(record, null, 2), "utf-8");
    await fs.promises.appendFile(RESULT_HISTORY_FILE, `${JSON.stringify(record)}\n`, "utf-8");
  } catch (persistError) {
    console.error("[RESULT] 写入结果文件失败:", persistError.message);
  }
}

function getJpegDimensions(buffer) {
  if (!buffer || buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return null;
  }

  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = buffer[offset + 1];
    if (marker === 0xd9 || marker === 0xda) {
      break;
    }

    const segmentLength = buffer.readUInt16BE(offset + 2);
    if (segmentLength < 2 || offset + 2 + segmentLength > buffer.length) {
      break;
    }

    if (
      marker === 0xc0 ||
      marker === 0xc1 ||
      marker === 0xc2 ||
      marker === 0xc3 ||
      marker === 0xc5 ||
      marker === 0xc6 ||
      marker === 0xc7 ||
      marker === 0xc9 ||
      marker === 0xca ||
      marker === 0xcb ||
      marker === 0xcd ||
      marker === 0xce ||
      marker === 0xcf
    ) {
      const height = buffer.readUInt16BE(offset + 5);
      const width = buffer.readUInt16BE(offset + 7);
      return { width, height };
    }

    offset += 2 + segmentLength;
  }

  return null;
}

function checkResolution(buffer) {
  const resolution = getJpegDimensions(buffer);
  if (!resolution) {
    return {
      width: 0,
      height: 0,
      minWidth: MIN_CAPTURE_WIDTH,
      minHeight: MIN_CAPTURE_HEIGHT,
      ok: false
    };
  }

  return {
    width: resolution.width,
    height: resolution.height,
    minWidth: MIN_CAPTURE_WIDTH,
    minHeight: MIN_CAPTURE_HEIGHT,
    ok: resolution.width >= MIN_CAPTURE_WIDTH && resolution.height >= MIN_CAPTURE_HEIGHT
  };
}

async function persistCaptureImages(cameraId, rawBuffer, annotatedImageBase64, resolutionCheck) {
  if (!screenshotEnabled) {
    return;
  }

  try {
    await fs.promises.mkdir(CAPTURE_DIR, { recursive: true });
    const safeCameraId = (cameraId || "camera").replace(/[^a-zA-Z0-9_-]/g, "_");
    const rawPath = path.join(CAPTURE_DIR, `${safeCameraId}_raw.jpg`);
    const annotatedPath = path.join(CAPTURE_DIR, `${safeCameraId}_annotated.jpg`);
    const metaPath = path.join(CAPTURE_DIR, `${safeCameraId}_meta.json`);

    if (rawBuffer) {
      await fs.promises.writeFile(rawPath, rawBuffer);
    }

    if (annotatedImageBase64) {
      await fs.promises.writeFile(annotatedPath, Buffer.from(annotatedImageBase64, "base64"));
    }

    await fs.promises.writeFile(
      metaPath,
      JSON.stringify(
        {
          cameraId: cameraId || "camera",
          timestamp: new Date().toISOString(),
          resolutionCheck
        },
        null,
        2
      ),
      "utf-8"
    );
  } catch (captureError) {
    console.error("[CAPTURE] 写入抓拍文件失败:", captureError.message);
  }
}

function persistCaptureImagesNonBlocking(cameraId, rawBuffer, annotatedImageBase64, resolutionCheck) {
  if (!screenshotEnabled) {
    return;
  }

  const key = cameraId || "camera";
  const now = Date.now();
  const lastSaveAt = cameraLastCaptureSaveAt.get(key) || 0;
  if (now - lastSaveAt < CAPTURE_SAVE_INTERVAL_MS) {
    return;
  }
  cameraLastCaptureSaveAt.set(key, now);
  void persistCaptureImages(cameraId, rawBuffer, annotatedImageBase64, resolutionCheck);
}

async function detectByBuffer(imageBuffer, experiment, conf = 0.25, options = {}) {
  const { returnAnnotated = true } = options;
  const form = new FormData();
  form.append("image", imageBuffer, {
    filename: "frame.jpg",
    contentType: "image/jpeg"
  });
  form.append("conf", String(conf));
  form.append("model_path", experiment.modelPath);
  form.append("class_names", JSON.stringify(experiment.classNames || []));
  form.append("return_annotated", returnAnnotated ? "1" : "0");

  const response = await axios.post(PYTHON_API, form, {
    headers: form.getHeaders(),
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    timeout: 30000
  });

  return response.data;
}

function captureRtspFrameWithStrategy(rtspUrl, strategyName, transport) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const stderrLines = [];
    let settled = false;
    const MAX_STDERR_LINES = 20;

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
      .addInputOption("-hide_banner")
      .addInputOption("-loglevel warning")
      .inputOptions([`-rtsp_transport ${transport}`, "-fflags +genpts", "-analyzeduration 0", "-probesize 200000"])
      .noAudio()
      .format("image2pipe")
      .outputOptions(["-map 0:v:0", "-frames:v 1", "-f image2", "-vcodec mjpeg", "-q:v 2"])
      .on("start", () => {
        console.log(`[RTSP][${strategyName}] 开始抓帧: ${rtspUrl}`);
      })
      .on("stderr", (line) => {
        if (!line || !line.trim()) {
          return;
        }
        stderrLines.push(line.trim());
        if (stderrLines.length > MAX_STDERR_LINES) {
          stderrLines.shift();
        }
      })
      .on("error", (error) => {
        const detail = stderrLines.join(" | ");
        const enhancedError = new Error(`[${strategyName}] ${error.message}${detail ? ` | ${detail}` : ""}`);
        settleReject(enhancedError);
      });

    const timer = setTimeout(() => {
      safeKill(command);
      const detail = stderrLines.join(" | ");
      settleReject(new Error(`[${strategyName}] RTSP 截图超时${detail ? ` | ${detail}` : ""}`));
    }, 6000);

    const stream = command.pipe();

    stream.on("data", (chunk) => {
      chunks.push(chunk);
    });

    stream.on("end", () => {
      if (!chunks.length) {
        const detail = stderrLines.join(" | ");
        settleReject(new Error(`[${strategyName}] RTSP 未返回有效图像帧${detail ? ` | ${detail}` : ""}`));
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
      const detail = stderrLines.join(" | ");
      const enhancedError = new Error(`[${strategyName}] ${error.message}${detail ? ` | ${detail}` : ""}`);
      settleReject(enhancedError);
    });
  });
}

async function captureRtspFrame(rtspUrl) {
  const strategies = [
    { name: "tcp", transport: "tcp" },
    { name: "udp", transport: "udp" }
  ];

  const errors = [];
  for (const strategy of strategies) {
    try {
      const frame = await captureRtspFrameWithStrategy(rtspUrl, strategy.name, strategy.transport);
      return frame;
    } catch (error) {
      errors.push(error.message);
      console.warn(`[RTSP][${strategy.name}] 抓帧失败: ${error.message}`);
    }
  }

  throw new Error(`RTSP 抓帧失败: ${errors.join(" || ")}`);
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
  const resolutionCheck = checkResolution(frameBuffer);
  const detectResult = await detectByBuffer(frameBuffer, experiment, conf);
  persistCaptureImagesNonBlocking(camera.id, frameBuffer, detectResult.annotatedImageBase64 || null, resolutionCheck);
  const boxes = detectResult.boxes || [];
  const classCounts = buildClassCounts(boxes);
  const scoreResult = applyCumulativeScore(
    experiment.key,
    camera.id,
    experiment,
    scoreExperiment(experiment, classCounts)
  );

  return {
    ...camera,
    online: true,
    error: null,
    boxes,
    classCounts,
    snapshotBase64: screenshotEnabled ? detectResult.annotatedImageBase64 || frameBuffer.toString("base64") : null,
    resolutionCheck,
    ...scoreResult
  };
}

async function captureOneCamera(camera, experiment) {
  if (!camera.rtspUrl) {
    return {
      camera,
      ok: false,
      error: "未配置 RTSP 地址",
      frameBuffer: null
    };
  }

  try {
    const frameBuffer = await Promise.race([
      captureRtspFrame(camera.rtspUrl),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error("单路抓帧超时")), 6000);
      })
    ]);
    return {
      camera,
      ok: true,
      error: null,
      frameBuffer
    };
  } catch (error) {
    return {
      camera,
      ok: false,
      error: error.message,
      frameBuffer: null
    };
  }
}

async function detectOneCamera(captured, experiment, conf, options = {}) {
  const { includeImage = true } = options;
  const { camera, ok, error, frameBuffer } = captured;
  if (!ok || !frameBuffer) {
    const cumulativeScore = getCumulativeScoreSnapshot(experiment.key, camera.id, experiment);
    return {
      ...camera,
      online: false,
      error: error || "摄像头连接失败",
      boxes: [],
      classCounts: {},
      ...cumulativeScore,
      snapshotBase64: null
    };
  }

  try {
    const resolutionCheck = checkResolution(frameBuffer);
    const detectResult = await Promise.race([
      detectByBuffer(frameBuffer, experiment, conf, { returnAnnotated: includeImage }),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error("单路识别超时")), 8000);
      })
    ]);
    persistCaptureImagesNonBlocking(camera.id, frameBuffer, detectResult.annotatedImageBase64 || null, resolutionCheck);
    const boxes = detectResult.boxes || [];
    const classCounts = buildClassCounts(boxes);
    const scoreResult = applyCumulativeScore(
      experiment.key,
      camera.id,
      experiment,
      scoreExperiment(experiment, classCounts)
    );
    const imageBase64 =
      screenshotEnabled && includeImage
        ? detectResult.annotatedImageBase64 || frameBuffer.toString("base64")
        : undefined;
    return {
      ...camera,
      online: true,
      error: null,
      boxes,
      classCounts,
      ...(imageBase64 !== undefined ? { snapshotBase64: imageBase64 } : {}),
      resolutionCheck,
      ...scoreResult
    };
  } catch (detectError) {
    const resolutionCheck = checkResolution(frameBuffer);
    persistCaptureImagesNonBlocking(camera.id, frameBuffer, null, resolutionCheck);
    const cumulativeScore = getCumulativeScoreSnapshot(experiment.key, camera.id, experiment);
    return {
      ...camera,
      online: false,
      error: detectError.message,
      boxes: [],
      classCounts: {},
      ...cumulativeScore,
      snapshotBase64: screenshotEnabled ? frameBuffer.toString("base64") : null,
      resolutionCheck
    };
  }
}

app.get("/api/experiments", async (req, res) => {
  try {
    experiments = readExperiments();

    if (!activeExperimentKey || !experiments[activeExperimentKey]) {
      activeExperimentKey =
        Object.keys(experiments).find((key) => experiments[key].isDefault) || Object.keys(experiments)[0] || null;
    }

    return res.json({
      code: 0,
      msg: "success",
      data: {
        activeExperimentKey,
        settings: {
          screenshotEnabled
        },
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

app.get("/api/settings", (req, res) => {
  return res.json({
    code: 0,
    msg: "success",
    data: {
      screenshotEnabled
    }
  });
});

app.post("/api/settings/screenshot", (req, res) => {
  screenshotEnabled = Boolean(req.body?.enabled);
  return res.json({
    code: 0,
    msg: "success",
    data: {
      screenshotEnabled
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
    const {
      experimentKey,
      cameras = [],
      conf = 0.25,
      whitelistOnly = false,
      targetCameraIds = [],
      lightweightMode = false,
      imageCameraIds = []
    } = req.body || {};
    const experiment = getExperiment(experimentKey);

    if (!experiment) {
      return res.status(404).json({
        code: 404,
        msg: "未找到实验配置"
      });
    }

    const normalizedCameras = normalizeCameraList(cameras);
    const targetSet = new Set(Array.isArray(targetCameraIds) ? targetCameraIds : []);
    const allConfiguredCameras = normalizedCameras.filter((camera) => {
      if (!camera.rtspUrl) {
        return false;
      }
      if (targetSet.size > 0 && !targetSet.has(camera.id)) {
        return false;
      }
      return true;
    });

    let candidateCameras = allConfiguredCameras.filter((camera) => {
      if (!whitelistOnly) {
        return true;
      }
      return Boolean(camera.whitelist);
    });

    if (whitelistOnly && candidateCameras.length === 0) {
      console.warn("[ANALYZE] 白名单模式开启，但白名单为空，自动回退到全部已配置摄像头");
      candidateCameras = allConfiguredCameras;
    }
    const resultMap = {};
    console.log(`[ANALYZE] 并行抓帧开始，摄像头数量: ${candidateCameras.length}, 白名单模式: ${whitelistOnly}`);
    const capturedList = await Promise.all(candidateCameras.map((camera) => captureOneCamera(camera, experiment)));
    console.log("[ANALYZE] 并行识别开始");
    const imageCameraSet = new Set(Array.isArray(imageCameraIds) ? imageCameraIds : []);
    const analyzedResults = await Promise.all(
      capturedList.map((captured) => {
        const includeImage = screenshotEnabled && (!lightweightMode || imageCameraSet.has(captured.camera.id));
        return detectOneCamera(captured, experiment, conf, { includeImage });
      })
    );
    analyzedResults.forEach((item) => {
      resultMap[item.id] = item;
    });
    const results = normalizedCameras.map((camera) => {
      if (resultMap[camera.id]) {
        return resultMap[camera.id];
      }
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
    });

    const summary = {
      totalScore: results.reduce((sum, item) => sum + item.totalScore, 0),
      maxScore: results.reduce((sum, item) => sum + item.maxScore, 0),
      onlineCount: results.filter((item) => item.online).length
    };

    await persistResultRecord({
      type: "batch_analyze",
      timestamp: new Date().toISOString(),
      experiment: serializeExperiment(experiment),
      summary,
      cameras: results.map(simplifyCameraResult)
    });

    return res.json({
      code: 0,
      msg: "success",
      data: {
        experiment: serializeExperiment(experiment),
        cameras: results,
        summary
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

    const response = await detectByBuffer(req.file.buffer, experiment, req.body.conf || "0.25", {
      returnAnnotated: screenshotEnabled
    });
    const resolutionCheck = checkResolution(req.file.buffer);
    persistCaptureImagesNonBlocking(
      "single_detect",
      req.file.buffer,
      response.annotatedImageBase64 || null,
      resolutionCheck
    );
    const classCounts = buildClassCounts(response.boxes || []);
    const scoreResult = scoreExperiment(experiment, classCounts);

    await persistResultRecord({
      type: "single_detect",
      timestamp: new Date().toISOString(),
      experiment: serializeExperiment(experiment),
      summary: {
        totalScore: Number(scoreResult.totalScore || 0),
        maxScore: Number(scoreResult.maxScore || 0),
        onlineCount: 1
      },
      resolutionCheck,
      classCounts,
      stateResults: (scoreResult.stateResults || []).map((state) => ({
        state: state.state,
        score: Number(state.score || 0),
        earnedScore: Number(state.earnedScore || 0),
        passed: Boolean(state.passed)
      }))
    });

    return res.json({
      ...response,
      experiment: serializeExperiment(experiment),
      classCounts,
      resolutionCheck,
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
          ws.send(
            JSON.stringify({
              type: "error",
              message: `FFmpeg错误: ${err.message}`
            })
          );
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
