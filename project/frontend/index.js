const API_URL = "/api/detect";
const CONFIG_URL = "./config.json";
const DEFAULT_EXPERIMENT_NAME = "defaultExperiment";
const DETECT_CONFIDENCE = 0.25;

const video = document.getElementById("video");
const overlay = document.getElementById("overlay");
const ctx = overlay.getContext("2d");

const btnStartCamera = document.getElementById("btnStartCamera");
const btnStartDetect = document.getElementById("btnStartDetect");
const btnStopDetect = document.getElementById("btnStopDetect");

const experimentInfo = document.getElementById("experimentInfo");
const scoreSummary = document.getElementById("scoreSummary");
const scoreCards = document.getElementById("scoreCards");
const countInfo = document.getElementById("countInfo");
const stateBox = document.getElementById("stateBox");
const scoreModeToggle = document.getElementById("scoreModeToggle");
const scoreModeText = document.getElementById("scoreModeText");
const debugInfo = document.getElementById("debugInfo");

let mediaStream = null;
let detecting = false;
let busy = false;
let detectTimer = null;
let configLoaded = false;

let currentExperimentName = DEFAULT_EXPERIMENT_NAME;
let currentExperimentConfig = null;
let CLASS_NAMES = [];
let STATE_RULES = {};
let SCORE_RULES = [];

let experimentScore = 0;
let experimentProgressIndex = 0;
let stateScoreMap = new Map();
let sequentialScoring = true;

const CAPTURE_WIDTH = 640;
const CAPTURE_HEIGHT = 640;
const JPEG_QUALITY = 0.65;
const DETECT_INTERVAL = 1200;

const captureCanvas = document.createElement("canvas");
const captureCtx = captureCanvas.getContext("2d", { willReadFrequently: true });

function log() {}

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

function updateScoreModeText() {
  scoreModeText.textContent = sequentialScoring ? "按顺序得分" : "检测即得分";
}

function createInitialScoreMap() {
  return new Map(SCORE_RULES.map((item) => [item.state, false]));
}

function renderScoreCards() {
  scoreCards.innerHTML = "";

  for (const rule of SCORE_RULES) {
    const done = Boolean(stateScoreMap.get(rule.state));
    const card = document.createElement("div");
    card.className = `score-card ${done ? "done" : "pending"}`;

    const left = document.createElement("div");
    left.className = "score-card-left";

    const title = document.createElement("div");
    title.className = "score-card-title";
    title.textContent = rule.state;

    const points = document.createElement("div");
    points.className = "score-card-score";
    points.textContent = `分值：${Number(rule.score) || 0} 分`;

    left.appendChild(title);
    left.appendChild(points);

    const right = document.createElement("div");
    right.className = `score-card-status ${done ? "done" : "pending"}`;
    right.textContent = done ? "已得分" : "未得分";

    card.appendChild(left);
    card.appendChild(right);
    scoreCards.appendChild(card);
  }
}

function updateScoreUI() {
  scoreSummary.textContent = `总分：${experimentScore} 分`;
  renderScoreCards();
}

function resetExperimentProgress() {
  experimentScore = 0;
  experimentProgressIndex = 0;
  stateScoreMap = createInitialScoreMap();
  updateScoreUI();
  debugInfo.textContent = "等待检测...";
}

function markStateScored(rule) {
  if (!rule || stateScoreMap.get(rule.state)) return false;
  stateScoreMap.set(rule.state, true);
  experimentScore += Number(rule.score) || 0;
  updateScoreUI();
  return true;
}

function applyScoreByState(state) {
  if (!state || state === "unknown") {
    return {
      scored: false,
      reason: "当前未匹配到可得分状态"
    };
  }

  if (sequentialScoring) {
    const currentRule = SCORE_RULES[experimentProgressIndex];

    if (!currentRule) {
      return {
        scored: false,
        reason: "全部状态已完成"
      };
    }

    if (state !== currentRule.state) {
      return {
        scored: false,
        reason: `顺序模式下，当前必须先完成 ${currentRule.state}，当前识别为 ${state}`
      };
    }

    const added = markStateScored(currentRule);
    if (added) {
      experimentProgressIndex += 1;
      return {
        scored: true,
        reason: `${state} 已得分`
      };
    }

    return {
      scored: false,
      reason: `${state} 已经得过分，忽略重复计分`
    };
  }

  const matchedRule = SCORE_RULES.find((item) => item.state === state);
  if (!matchedRule) {
    return {
      scored: false,
      reason: `状态 ${state} 不在得分配置中`
    };
  }

  const added = markStateScored(matchedRule);
  if (added) {
    return {
      scored: true,
      reason: `${state} 已得分`
    };
  }

  return {
    scored: false,
    reason: `${state} 已经得过分，忽略重复计分`
  };
}

function checkCameraSupport() {
  btnStartCamera.disabled = false;
}

async function startCamera() {
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" }
      },
      audio: false
    });

    video.srcObject = mediaStream;
    await video.play();

    resizeCanvas();
    btnStartDetect.disabled = !configLoaded;
  } catch (err) {
    console.error(err);
    alert("打开摄像头失败: " + err.message);
  }
}

function stopCamera() {
  if (mediaStream) {
    mediaStream.getTracks().forEach((track) => track.stop());
    mediaStream = null;
  }
  video.srcObject = null;
}

function resizeCanvas() {
  const rect = video.getBoundingClientRect();
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
  for (const [k, v] of Object.entries(rule || {})) {
    if ((counter[k] || 0) < v) return false;
  }
  return true;
}

function analyzeRule(counter, rule) {
  const missing = [];
  const extra = [];
  const satisfied = [];

  for (const name of CLASS_NAMES) {
    const expected = Number(rule?.[name] || 0);
    const actual = Number(counter?.[name] || 0);

    if (expected <= 0) {
      if (actual > 0) {
        extra.push(`${name} 多了 ${actual}`);
      }
      continue;
    }

    if (actual < expected) {
      missing.push(`${name} 还差 ${expected - actual}（当前${actual}/需要${expected}）`);
    } else if (actual > expected) {
      satisfied.push(`${name} 已满足（当前${actual}/需要${expected}）`);
      extra.push(`${name} 多了 ${actual - expected}`);
    } else {
      satisfied.push(`${name} 已满足（当前${actual}/需要${expected}）`);
    }
  }

  return {
    matched: missing.length === 0,
    missing,
    extra,
    satisfied
  };
}

function getRuleByState(stateName) {
  return STATE_RULES[stateName] || {};
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

function formatRuleDebug(stateName, counter) {
  const rule = getRuleByState(stateName);
  const analysis = analyzeRule(counter, rule);
  const lines = [];

  lines.push(`目标状态: ${stateName}`);
  lines.push(`规则匹配: ${analysis.matched ? "是" : "否"}`);
  lines.push(`满足条件: ${analysis.satisfied.length ? analysis.satisfied.join("，") : "无"}`);
  lines.push(`缺少类别: ${analysis.missing.length ? analysis.missing.join("，") : "无"}`);

  return lines.join("\n");
}

function updateDebugUI(counter, state, scoreResult) {
  const lines = [];
  lines.push(`当前识别状态: ${state}`);
  lines.push(`得分模式: ${sequentialScoring ? "按顺序得分" : "检测即得分"}`);
  lines.push(`本轮得分结果: ${scoreResult?.scored ? "已加分" : "未加分"}`);
  if (scoreResult?.reason) {
    lines.push(`原因说明: ${scoreResult.reason}`);
  }

  if (sequentialScoring) {
    const nextRule = SCORE_RULES[experimentProgressIndex];

    if (!nextRule) {
      lines.push("下一步状态: 全部状态已完成");
    } else {
      lines.push(`下一步必须满足状态: ${nextRule.state}`);
      lines.push("");
      lines.push(formatRuleDebug(nextRule.state, counter));
    }
  } else {
    const pendingRules = SCORE_RULES.filter((item) => !stateScoreMap.get(item.state));

    if (!pendingRules.length) {
      lines.push("未得分状态检查: 全部状态已完成");
    } else {
      lines.push("未得分状态检查:");
      for (const rule of pendingRules) {
        lines.push("");
        lines.push(formatRuleDebug(rule.state, counter));
      }
    }
  }

  debugInfo.textContent = lines.join("\n");
}

function captureBlob() {
  return new Promise((resolve, reject) => {
    if (!video.videoWidth || !video.videoHeight) {
      reject(new Error("视频尺寸不可用"));
      return;
    }

    captureCanvas.width = CAPTURE_WIDTH;
    captureCanvas.height = CAPTURE_HEIGHT;

    captureCtx.drawImage(video, 0, 0, CAPTURE_WIDTH, CAPTURE_HEIGHT);

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
    formData.append("conf", DETECT_CONFIDENCE);

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

    const scoreResult = applyScoreByState(state);
    updateDebugUI(counter, state, scoreResult);
  } catch (err) {
    console.error(err);
    debugInfo.textContent = `检测失败: ${err.message}`;
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
  debugInfo.textContent = "已停止检测";
}

scoreModeToggle.addEventListener("change", () => {
  sequentialScoring = !scoreModeToggle.checked;
  updateScoreModeText();
  if (!detecting) {
    resetExperimentProgress();
  }
});

btnStartCamera.addEventListener("click", startCamera);
btnStartDetect.addEventListener("click", startDetect);
btnStopDetect.addEventListener("click", stopDetect);

window.addEventListener("beforeunload", () => {
  stopDetect();
  stopCamera();
});

btnStartCamera.disabled = true;
btnStartDetect.disabled = true;
btnStopDetect.disabled = true;

(async function init() {
  try {
    await loadExperimentConfig();
    updateScoreModeText();
    checkCameraSupport();
  } catch (err) {
    console.error(err);
    alert(err.message);
  }
})();
