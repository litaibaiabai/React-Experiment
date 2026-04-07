const API_URL = "/api/detect";
const CONFIG_URL = "./config.json";
const WEBSOCKET_URL = "/ws/rtsp";
const RTSP_URL = "rtsp://admin:@192.168.1.11:554/Streaming/Channels/101";
const DEFAULT_EXPERIMENT_NAME = "defaultExperiment";

const videoEl = document.getElementById("rtspVideo");
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

let flvPlayer = null;
let websocketConnected = false;
let detecting = false;
let busy = false;
let detectTimer = null;
let configLoaded = false;
let renderTimer = null;
let currentFrameReady = false;

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
  resetExperimentProgress();
}

function renderExperimentInfo() {
  const displayName = currentExperimentConfig.displayName || currentExperimentName;
  experimentInfo.textContent = `实验名称: ${displayName}\n`;
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

  if (typeof flvjs === "undefined") {
    log("未加载 flv.js");
    return;
  }

  if (!flvjs.isSupported()) {
    log("当前浏览器不支持 flv.js 播放");
    btnStartCamera.disabled = true;
    return;
  }

  log("页面已就绪，等待连接RTSP摄像头");
}

function resizeCanvas() {
  const rect = videoCanvas.parentElement.getBoundingClientRect();
  videoCanvas.width = rect.width;
  videoCanvas.height = rect.height;
  overlay.width = rect.width;
  overlay.height = rect.height;
}

window.addEventListener("resize", resizeCanvas);

function getWsFlvUrl() {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const host = location.host;
  return `${protocol}//${host}${WEBSOCKET_URL}?rtsp_url=${encodeURIComponent(RTSP_URL)}`;
}

function startRenderLoop() {
  stopRenderLoop();

  const draw = () => {
    if (
      videoEl &&
      videoEl.readyState >= 2 &&
      videoEl.videoWidth > 0 &&
      videoEl.videoHeight > 0
    ) {
      currentFrameReady = true;

      videoCtx.clearRect(0, 0, videoCanvas.width, videoCanvas.height);
      videoCtx.drawImage(videoEl, 0, 0, videoCanvas.width, videoCanvas.height);
    }

    renderTimer = requestAnimationFrame(draw);
  };

  renderTimer = requestAnimationFrame(draw);
}

function stopRenderLoop() {
  if (renderTimer) {
    cancelAnimationFrame(renderTimer);
    renderTimer = null;
  }
}

async function startCamera() {
  try {
    stopCamera();
    resizeCanvas();

    const flvUrl = getWsFlvUrl();

    flvPlayer = flvjs.createPlayer(
      {
        type: "flv",
        url: flvUrl,
        isLive: true,
        hasAudio: false,
        hasVideo: true
      },
      {
        enableWorker: false,
        enableStashBuffer: false,
        stashInitialSize: 32,
        isLive: true,
        lazyLoad: false,
        deferLoadAfterSourceOpen: false,
        autoCleanupSourceBuffer: true,
        autoCleanupMaxBackwardDuration: 1,
        autoCleanupMinBackwardDuration: 0.5
      }
    );

    flvPlayer.attachMediaElement(videoEl);

    flvPlayer.on(flvjs.Events.ERROR, (errorType, errorDetail, errorInfo) => {
      console.error("flv.js error:", errorType, errorDetail, errorInfo);
      log(`视频播放错误: ${errorType} / ${errorDetail}`);
    });

    flvPlayer.on(flvjs.Events.LOADING_COMPLETE, () => {
      log("视频流加载完成");
    });

    flvPlayer.on(flvjs.Events.METADATA_ARRIVED, () => {
      log("视频元数据已到达");
    });

    flvPlayer.load();

    try {
      await videoEl.play();
    } catch (err) {
      console.warn("video play warning:", err);
    }

    websocketConnected = true;
    startRenderLoop();

    btnStartDetect.disabled = !configLoaded;
    log("RTSP摄像头连接成功");
  } catch (err) {
    log("连接RTSP摄像头失败: " + err.message);
    console.error(err);
  }
}

function stopCamera() {
  websocketConnected = false;
  currentFrameReady = false;
  stopRenderLoop();

  if (flvPlayer) {
    try {
      flvPlayer.pause();
    } catch (_) {}

    try {
      flvPlayer.unload();
    } catch (_) {}

    try {
      flvPlayer.detachMediaElement();
    } catch (_) {}

    try {
      flvPlayer.destroy();
    } catch (_) {}

    flvPlayer = null;
  }

  if (videoEl) {
    videoEl.removeAttribute("src");
    videoEl.load();
  }

  videoCtx.clearRect(0, 0, videoCanvas.width, videoCanvas.height);
  ctx.clearRect(0, 0, overlay.width, overlay.height);
}

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
    if (!currentFrameReady || videoEl.readyState < 2 || videoEl.videoWidth <= 0) {
      reject(new Error("无可用视频帧"));
      return;
    }

    captureCanvas.width = CAPTURE_WIDTH;
    captureCanvas.height = CAPTURE_HEIGHT;

    captureCtx.drawImage(videoEl, 0, 0, CAPTURE_WIDTH, CAPTURE_HEIGHT);

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
  if (!currentFrameReady) return;

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
  if (!flvPlayer || !currentFrameReady) {
    log("请先连接RTSP摄像头");
    return;
  }

  resetExperimentProgress();
  detecting = true;
  btnStartDetect.disabled = true;
  btnStopDetect.disabled = false;
  log("开始实验，已进入检测流程");

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
  btnStartDetect.disabled = !websocketConnected || !configLoaded;
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

btnStartCamera.disabled = false;
btnStartDetect.disabled = true;
btnStopDetect.disabled = true;

setInterval(() => {
  if (!videoEl || !videoEl.buffered || videoEl.buffered.length === 0) return;

  const end = videoEl.buffered.end(videoEl.buffered.length - 1);
  const lag = end - videoEl.currentTime;

  // 落后太多时主动追到最新位置
  if (lag > 1.0) {
    videoEl.currentTime = Math.max(end - 0.15, 0);
  }
}, 500);

(async function init() {
  try {
    await loadExperimentConfig();
    checkCameraSupport();
    log(`实验配置已加载: ${currentExperimentName}`);
  } catch (err) {
    log(err.message);
    console.error(err);
  }
})();