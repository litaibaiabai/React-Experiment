const API_URL = "/api/detect";
const CONFIG_URL = "./config.json";
const WEBSOCKET_URL = "/ws/rtsp"; // WebSocket endpoint for RTSP stream
const RTSP_URL = "rtsp://admin:@192.168.1.11:554/Streaming/Channels/101";
const DEFAULT_EXPERIMENT_NAME = "defaultExperiment";

const videoCanvas = document.getElementById("videoCanvas");
const overlay = document.getElementById("overlay");
const videoCtx = videoCanvas.getContext("2d");
const ctx = overlay.getContext("2d");

const btnStartCamera = document.getElementById("btnStartCamera");
const btnStartDetect = document.getElementById("btnStartDetect");
const btnStopDetect = document.getElementById("btnStopDetect");

const experimentInfo = document.getElementById("experimentInfo");
const scoreInfo = document.getElementById("scoreInfo");
const countInfo = document.getElementById("countInfo");
const logEl = document.getElementById("log");
const stateBox = document.getElementById("stateBox");
const confRange = document.getElementById("confRange");
const confText = document.getElementById("confText");

let mediaStream = null;
let websocket = null;
let detecting = false;
let busy = false;
let detectTimer = null;
let configLoaded = false;
let currentFrameData = null; // Store the latest frame data from WebSocket

let currentExperimentName = DEFAULT_EXPERIMENT_NAME;
let currentExperimentConfig = null;
let CLASS_NAMES = [];
let STATE_RULES = {};
let SCORE_RULES = [];

let experimentScore = 0;
let experimentProgressIndex = 0;

const CAPTURE_WIDTH = 640;
const CAPTURE_HEIGHT = 640;
const JPEG_QUALITY = 0.65;
const DETECT_INTERVAL = 1200;

const captureCanvas = document.createElement("canvas");
const captureCtx = captureCanvas.getContext("2d", { willReadFrequently: true });

confRange.addEventListener("input", () => {
  confText.textContent = confRange.value;
});

function log(msg) {
  const time = new Date().toLocaleTimeString();
  logEl.textContent = `[${time}] ${msg}`;
}

function getExperimentName() {
  const urlName = new URLSearchParams(location.search).get("experiment");
  const bodyName = document.body.dataset.experimentName;
  return urlName || bodyName || DEFAULT_EXPERIMENT_NAME;
}

async function loadExperimentConfig() {
  const res = await fetch(CONFIG_URL, { cache: "no-cache" });
  if (!res.ok) {
    throw new Error(`加载实验配置失败: ${res.status}`);
  }

  const allConfig = await res.json();
  currentExperimentName = getExperimentName();
  currentExperimentConfig = allConfig[currentExperimentName] || allConfig[DEFAULT_EXPERIMENT_NAME];

  if (!currentExperimentConfig) {
    throw new Error("未找到可用的实验配置");
  }

  CLASS_NAMES = currentExperimentConfig.classNames || [];
  STATE_RULES = currentExperimentConfig.stateRules || {};
  SCORE_RULES = currentExperimentConfig.scoreRules || [];
  configLoaded = true;

  renderExperimentInfo();
  // renderRulesInfo(); // No rules display element in HTML
  resetExperimentProgress();
}

function renderExperimentInfo() {
  const displayName = currentExperimentConfig.displayName || currentExperimentName;
  experimentInfo.textContent = `实验名称: ${displayName}\n`;
}

function renderRulesInfo() {
  const lines = [];

  for (const [stateName, rule] of Object.entries(STATE_RULES)) {
    lines.push(`${stateName}:`);
    for (const [className, count] of Object.entries(rule)) {
      lines.push(`${className}=${count}`);
    }
    lines.push("");
  }

  if (SCORE_RULES.length) {
    lines.push("得分规则:");
    for (const item of SCORE_RULES) {
      lines.push(`${item.state} +${item.score}分`);
    }
  }
}

function updateScoreUI() {
  const totalSteps = SCORE_RULES.length;
  const finishedSteps = Math.min(experimentProgressIndex, totalSteps);
  scoreInfo.textContent = `${experimentScore} 分\n进度: ${finishedSteps}/${totalSteps}`;
}

function resetExperimentProgress() {
  experimentScore = 0;
  experimentProgressIndex = 0;
  updateScoreUI();
}

function applyScoreByState(state) {
  const currentRule = SCORE_RULES[experimentProgressIndex];
  if (!currentRule) return;
  if (state !== currentRule.state) return;

  experimentScore += Number(currentRule.score) || 0;
  experimentProgressIndex += 1;
  updateScoreUI();
  log(`实验状态达成: ${state}，当前得分 ${experimentScore} 分`);
}

function checkCameraSupport() {
  btnStartCamera.disabled = false;
  log("页面已就绪，等待打开摄像头");
}

async function startCamera() {
  try {
    // Close existing WebSocket if any
    if (websocket) {
      websocket.close();
    }

    // Connect to WebSocket server that handles RTSP stream
    const wsUrl = WEBSOCKET_URL + '?rtsp_url=' + encodeURIComponent(RTSP_URL);
    websocket = new WebSocket(wsUrl);

    websocket.onopen = () => {
      log("RTSP摄像头连接成功");
      resizeCanvas();
      btnStartDetect.disabled = !configLoaded;
    };

    websocket.onmessage = (event) => {
      if (event.data instanceof Blob) {
        // Handle video frame data
        const img = new Image();
        img.onload = () => {
          // Store the latest frame for detection
          currentFrameData = {
            image: img,
            width: img.width,
            height: img.height
          };

          // Display the frame on canvas
          videoCtx.clearRect(0, 0, videoCanvas.width, videoCanvas.height);
          videoCtx.drawImage(img, 0, 0, videoCanvas.width, videoCanvas.height);
        };
        img.src = URL.createObjectURL(event.data);
      }
    };

    websocket.onerror = (error) => {
      log("RTSP摄像头连接错误: " + error.message);
      console.error("WebSocket error:", error);
    };

    websocket.onclose = () => {
      log("RTSP摄像头连接已断开");
      if (detecting) {
        stopDetect();
      }
    };
  } catch (err) {
    log("连接RTSP摄像头失败: " + err.message);
    console.error(err);
  }
}

function stopCamera() {
  if (websocket) {
    websocket.close();
    websocket = null;
  }
  currentFrameData = null;
  videoCtx.clearRect(0, 0, videoCanvas.width, videoCanvas.height);
}

function resizeCanvas() {
  const rect = videoCanvas.parentElement.getBoundingClientRect();
  videoCanvas.width = rect.width;
  videoCanvas.height = rect.height;
  overlay.width = rect.width;
  overlay.height = rect.height;
}

window.addEventListener("resize", resizeCanvas);

function drawBoxes(boxes, frameW, frameH) {
  ctx.clearRect(0, 0, overlay.width, overlay.height);

  const scaleX = overlay.width / frameW;
  const scaleY = overlay.height / frameH;

  ctx.lineWidth = 2;
  ctx.font = "14px Arial";

  for (const b of boxes) {
    const x1 = b.x1 * scaleX;
    const y1 = b.y1 * scaleY;
    const x2 = b.x2 * scaleX;
    const y2 = b.y2 * scaleY;

    const color = "#00E5FF";
    ctx.strokeStyle = color;
    ctx.fillStyle = color;

    ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);

    const label = `${b.className} ${Number(b.score).toFixed(2)}`;
    const textW = ctx.measureText(label).width + 10;
    const textH = 20;

    ctx.fillRect(x1, Math.max(0, y1 - textH), textW, textH);
    ctx.fillStyle = "#fff";
    ctx.fillText(label, x1 + 5, Math.max(14, y1 - 6));
  }
}

function countClasses(boxes) {
  const counter = {};
  for (const name of CLASS_NAMES) counter[name] = 0;
  for (const b of boxes) {
    counter[b.className] = (counter[b.className] || 0) + 1;
  }
  return counter;
}

function matchStrict(counter, rule) {
  for (const [k, v] of Object.entries(rule)) {
    if ((counter[k] || 0) !== v) return false;
  }

  for (const name of CLASS_NAMES) {
    if (!(name in rule) && (counter[name] || 0) !== 0) return false;
  }

  return true;
}

function inferState(counter) {
  if (STATE_RULES.finish && matchStrict(counter, STATE_RULES.finish)) return "finish";
  if (STATE_RULES.connect && matchStrict(counter, STATE_RULES.connect)) return "connect";
  if (STATE_RULES.init && matchStrict(counter, STATE_RULES.init)) return "init";
  return "unknown";
}

function updateStateUI(state) {
  stateBox.className = "status-box";

  if (state === "init") stateBox.classList.add("state-init");
  else if (state === "connect") stateBox.classList.add("state-connect");
  else if (state === "finish") stateBox.classList.add("state-finish");
  else stateBox.classList.add("state-unknown");

  stateBox.textContent = `当前状态：${state}`;
}

function updateCountUI(counter) {
  const lines = [];
  for (const name of CLASS_NAMES) {
    const v = counter[name] || 0;
    if (v > 0) lines.push(`${name}: ${v}`);
  }
  countInfo.textContent = lines.length ? lines.join("\n") : "未检测到目标";
}

function captureBlob() {
  return new Promise((resolve, reject) => {
    if (!currentFrameData) {
      reject(new Error("无可用视频帧"));
      return;
    }

    captureCanvas.width = CAPTURE_WIDTH;
    captureCanvas.height = CAPTURE_HEIGHT;

    // Draw the current frame to capture canvas
    captureCtx.drawImage(currentFrameData.image, 0, 0, CAPTURE_WIDTH, CAPTURE_HEIGHT);

    captureCanvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("截图失败"));
          return;
        }
        resolve(blob);
      },
      "image/jpeg",
      JPEG_QUALITY
    );
  });
}

async function detectOnce() {
  if (!detecting || busy) return;
  if (video.readyState < 2) return;

  busy = true;

  try {
    const blob = await captureBlob();

    const formData = new FormData();
    formData.append("image", blob, "frame.jpg");
    formData.append("conf", confRange.value);

    const res = await fetch(API_URL, {
      method: "POST",
      body: formData
    });

    if (!res.ok) {
      throw new Error(`接口异常: ${res.status}`);
    }

    const result = await res.json();

    const boxes = result.boxes || [];
    drawBoxes(boxes, CAPTURE_WIDTH, CAPTURE_HEIGHT);

    const counter = countClasses(boxes);
    const state = inferState(counter);

    console.log("debug", boxes);

    updateCountUI(counter);
    updateStateUI(state);
    applyScoreByState(state);
  } catch (err) {
    log("检测失败: " + err.message);
    console.error(err);
  } finally {
    busy = false;
  }
}

function startDetect() {
  if (detecting || !configLoaded) return;

  resetExperimentProgress();
  detecting = true;
  btnStartDetect.disabled = true;
  btnStopDetect.disabled = false;
  log("开始实验，点击后已进入检测流程（后端推理）");

  detectOnce();
  detectTimer = setInterval(detectOnce, DETECT_INTERVAL);
}

function stopDetect() {
  detecting = false;

  if (detectTimer) {
    clearInterval(detectTimer);
    detectTimer = null;
  }

  busy = false;
  btnStartDetect.disabled = !mediaStream || !configLoaded;
  btnStopDetect.disabled = true;

  ctx.clearRect(0, 0, overlay.width, overlay.height);
  updateStateUI("unknown");
  countInfo.textContent = "已停止检测";
  log("停止实验");
}

btnStartCamera.addEventListener("click", startCamera);
btnStartDetect.addEventListener("click", startDetect);
btnStopDetect.addEventListener("click", stopDetect);

window.addEventListener("beforeunload", () => {
  stopDetect();
  stopCamera();
});

btnStartCamera.disabled = false; // Enable RTSP connection button immediately
btnStartDetect.disabled = true;
btnStopDetect.disabled = true;

(async function init() {
  try {
    await loadExperimentConfig();
    checkCameraSupport();
    log(`实验配置已加载: ${currentExperimentName}`);
  } catch (err) {
    // experimentInfo.textContent = err.message;
    log(err.message);
    console.error(err);
  }
})();
