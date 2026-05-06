const path = require("path");
const fs = require("fs");
const axios = require("axios");
const {
  buildClassCounts,
  scoreExperiment,
  getCumulativeScoreSnapshot,
  applyCumulativeScore,
  normalizeCameraList,
  simplifyCameraResult
} = require("../utils/fn");
const {
  checkResolution,
  persistCaptureImagesNonBlocking,
  detectByBuffer,
  captureOneCamera,
  detectOneCamera
} = require("../utils/camera");

function createExpService(options = {}) {
  const baseDir = options.baseDir || __dirname;
  const pythonApi = options.pythonApi || "http://127.0.0.1:3008/detect";
  const pythonLoadModelApi = options.pythonLoadModelApi || "http://127.0.0.1:3008/load-model";
  const experimentDir = options.experimentDir || path.join(baseDir, "experiments");
  const cameraConfigPath = options.cameraConfigPath || path.join(baseDir, "cameras.json");
  const resultDir = options.resultDir || path.join(baseDir, "results");
  const resultLatestFile = options.resultLatestFile || path.join(resultDir, "latest.json");
  const resultHistoryFile = options.resultHistoryFile || path.join(resultDir, "history.jsonl");
  const captureDir = options.captureDir || path.join(baseDir, "capture");
  const minCaptureWidth = Number(options.minCaptureWidth || 640);
  const minCaptureHeight = Number(options.minCaptureHeight || 360);
  const captureSaveIntervalMs = Number(options.captureSaveIntervalMs || 1500);

  const cameraLastCaptureSaveAt = new Map();
  const cumulativeScoreMemory = new Map();
  let screenshotEnabled = options.screenshotEnabled !== undefined ? Boolean(options.screenshotEnabled) : true;
  let experiments = {};
  let activeExperimentKey = null;

  function readExperiments() {
    if (!fs.existsSync(experimentDir)) {
      return {};
    }

    const files = fs.readdirSync(experimentDir).filter((fileName) => fileName.endsWith(".json"));

    return files.reduce((accumulator, fileName) => {
      const filePath = path.join(experimentDir, fileName);
      const experimentKey = path.basename(fileName, ".json");
      const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));

      accumulator[experimentKey] = {
        key: experimentKey,
        filePath,
        ...raw,
        modelPath: path.resolve(baseDir, raw.modelPath)
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

    if (!fs.existsSync(cameraConfigPath)) {
      return base;
    }

    const raw = JSON.parse(fs.readFileSync(cameraConfigPath, "utf-8"));
    const cameras = Array.isArray(raw?.cameras) ? raw.cameras : [];

    return base.map((camera, index) => ({
      ...camera,
      ...(cameras[index] || {})
    }));
  }

  function bootstrap() {
    experiments = readExperiments();
    activeExperimentKey =
      Object.keys(experiments).find((key) => experiments[key].isDefault) || Object.keys(experiments)[0] || null;
  }

  function getExperiment(experimentKey = activeExperimentKey) {
    if (!experimentKey) {
      return null;
    }
    return experiments[experimentKey] || null;
  }

  function ensureActiveExperimentKey() {
    if (!activeExperimentKey || !experiments[activeExperimentKey]) {
      activeExperimentKey =
        Object.keys(experiments).find((key) => experiments[key].isDefault) || Object.keys(experiments)[0] || null;
    }
    return activeExperimentKey;
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
      pythonLoadModelApi,
      {
        model_path: experiment.modelPath,
        class_names: experiment.classNames || []
      },
      {
        timeout: 30000
      }
    );
  }

  async function persistResultRecord(record) {
    try {
      await fs.promises.mkdir(resultDir, { recursive: true });
      await fs.promises.writeFile(resultLatestFile, JSON.stringify(record, null, 2), "utf-8");
      await fs.promises.appendFile(resultHistoryFile, `${JSON.stringify(record)}\n`, "utf-8");
    } catch (persistError) {
      console.error("[RESULT] 写入结果文件失败:", persistError.message);
    }
  }

  function buildCameraServices() {
    return {
      screenshotEnabled,
      minCaptureWidth,
      minCaptureHeight,
      pythonApi,
      captureDir,
      captureSaveIntervalMs,
      cameraLastCaptureSaveAt,
      getCumulativeScoreSnapshot,
      applyCumulativeScore,
      buildClassCounts,
      scoreExperiment,
      cumulativeScoreMemory
    };
  }

  function setScreenshotEnabled(enabled) {
    screenshotEnabled = Boolean(enabled);
    return screenshotEnabled;
  }

  function getScreenshotEnabled() {
    return screenshotEnabled;
  }

  function refreshExperiments() {
    experiments = readExperiments();
    ensureActiveExperimentKey();
    return experiments;
  }

  function setActiveExperimentKey(nextKey) {
    activeExperimentKey = nextKey;
  }

  bootstrap();

  return {
    readCameraConfig,
    getExperiment,
    ensureActiveExperimentKey,
    serializeExperiment,
    preloadExperimentModel,
    persistResultRecord,
    buildCameraServices,
    scoreExperiment,
    simplifyCameraResult,
    normalizeCameraList,
    captureOneCamera,
    detectOneCamera,
    detectByBuffer,
    checkResolution,
    persistCaptureImagesNonBlocking,
    buildClassCounts,
    getScreenshotEnabled,
    setScreenshotEnabled,
    refreshExperiments,
    getActiveExperimentKey: () => activeExperimentKey,
    setActiveExperimentKey,
    getPythonApi: () => pythonApi,
    getMinCaptureWidth: () => minCaptureWidth,
    getMinCaptureHeight: () => minCaptureHeight,
    getCaptureSaveIntervalMs: () => captureSaveIntervalMs,
    getCaptureDir: () => captureDir,
    getCameraLastCaptureSaveAt: () => cameraLastCaptureSaveAt
  };
}

module.exports = {
  createExpService
};
