const multer = require("multer");

// 上传接口使用内存存储，避免单张图片先落盘再读取。
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 6 * 1024 * 1024
  }
});

function registerExpRoutes(app, service) {

  // 返回实验、摄像头和当前全局设置，供前端初始化页面状态。
  app.get("/api/experiments", async (req, res) => {
    try {
      const experiments = service.refreshExperiments();

      return res.json({
        code: 0,
        msg: "success",
        data: {
          activeExperimentKey: service.getActiveExperimentKey(),
          settings: {
            screenshotEnabled: service.getScreenshotEnabled()
          },
          cameras: service.readCameraConfig(),
          experiments: Object.values(experiments).map(service.serializeExperiment)
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

  // 返回摄像头配置原始列表。
  app.get("/api/cameras", (req, res) => {
    return res.json({
      code: 0,
        msg: "success",
        data: {
          cameras: service.readCameraConfig()
        }
      });
  });

  // 返回当前系统开关设置。
  app.get("/api/settings", (req, res) => {
    return res.json({
      code: 0,
      msg: "success",
      data: {
        screenshotEnabled: service.getScreenshotEnabled()
      }
    });
  });

  // 开关截图落盘功能。
  app.post("/api/settings/screenshot", (req, res) => {
    service.setScreenshotEnabled(Boolean(req.body?.enabled));
    return res.json({
      code: 0,
      msg: "success",
      data: {
        screenshotEnabled: service.getScreenshotEnabled()
      }
    });
  });

  // 切换当前实验，并在切换前预加载对应模型。
  app.post("/api/experiments/select", async (req, res) => {
    try {
      const { experimentKey } = req.body || {};
      const experiment = service.getExperiment(experimentKey);

      if (!experiment) {
        return res.status(404).json({
          code: 404,
          msg: "实验不存在"
        });
      }

      await service.preloadExperimentModel(experiment);
      service.setActiveExperimentKey(experiment.key);

      return res.json({
        code: 0,
        msg: "success",
        data: {
          activeExperimentKey: service.getActiveExperimentKey(),
          experiment: service.serializeExperiment(experiment)
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

  // 返回当前激活的实验详情。
  app.get("/api/experiments/active", (req, res) => {
    return res.json({
      code: 0,
      msg: "success",
      data: {
        activeExperimentKey: service.getActiveExperimentKey(),
        experiment: service.serializeExperiment(service.getExperiment())
      }
    });
  });

  // 批量分析摄像头：先抓帧，再并行识别，最后汇总得分并持久化结果。
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
      const experiment = service.getExperiment(experimentKey);

      if (!experiment) {
        return res.status(404).json({
          code: 404,
          msg: "未找到实验配置"
        });
      }

      const normalizedCameras = service.normalizeCameraList(service.readCameraConfig(), cameras);
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
      const capturedList = await Promise.all(candidateCameras.map((camera) => service.captureOneCamera(camera)));
      console.log("[ANALYZE] 并行识别开始");
      const imageCameraSet = new Set(Array.isArray(imageCameraIds) ? imageCameraIds : []);
      const cameraServices = service.buildCameraServices();
      const analyzedResults = await Promise.all(
        capturedList.map((captured) => {
          const includeImage =
            service.getScreenshotEnabled() && (!lightweightMode || imageCameraSet.has(captured.camera.id));
          return service.detectOneCamera(captured, experiment, conf, cameraServices, { includeImage });
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
          maxScore: service.scoreExperiment(experiment, {}).maxScore,
          snapshotBase64: null
        };
      });

      const summary = {
        totalScore: results.reduce((sum, item) => sum + item.totalScore, 0),
        maxScore: results.reduce((sum, item) => sum + item.maxScore, 0),
        onlineCount: results.filter((item) => item.online).length
      };

      await service.persistResultRecord({
        type: "batch_analyze",
        timestamp: new Date().toISOString(),
        experiment: service.serializeExperiment(experiment),
        summary,
        cameras: results.map(service.simplifyCameraResult)
      });

      return res.json({
        code: 0,
        msg: "success",
        data: {
          experiment: service.serializeExperiment(experiment),
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

  // 单张图片识别接口，供前端上传图片或外部系统调用。
  app.post("/api/detect", upload.single("image"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          code: 400,
          msg: "缺少图片文件 image",
          data: null
        });
      }

      const experiment = service.getExperiment(req.body.experimentKey);

      if (!experiment) {
        return res.status(404).json({
          code: 404,
          msg: "实验不存在"
        });
      }

      const response = await service.detectByBuffer(req.file.buffer, experiment, req.body.conf || "0.25", {
        returnAnnotated: service.getScreenshotEnabled(),
        pythonApi: service.getPythonApi()
      });
      const resolutionCheck = service.checkResolution(
        req.file.buffer,
        service.getMinCaptureWidth(),
        service.getMinCaptureHeight()
      );
      service.persistCaptureImagesNonBlocking({
        screenshotEnabled: service.getScreenshotEnabled(),
        cameraLastCaptureSaveAt: service.getCameraLastCaptureSaveAt(),
        captureSaveIntervalMs: service.getCaptureSaveIntervalMs(),
        captureDir: service.getCaptureDir(),
        cameraId: "single_detect",
        rawBuffer: req.file.buffer,
        annotatedImageBase64: response.annotatedImageBase64 || null,
        resolutionCheck
      });
      const classCounts = service.buildClassCounts(response.boxes || []);
      const scoreResult = service.scoreExperiment(experiment, classCounts);

      await service.persistResultRecord({
        type: "single_detect",
        timestamp: new Date().toISOString(),
        experiment: service.serializeExperiment(experiment),
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
        experiment: service.serializeExperiment(experiment),
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

  // 兜底 404，避免未命中的接口返回非 JSON 内容。
  app.use((req, res) => {
    res.status(404).json({
      code: 404,
      msg: "请求的资源不存在",
      data: null
    });
  });

  // 全局错误处理，保证异常统一返回 JSON。
  app.use((err, req, res, next) => {
    console.error("全局错误:", err);
    res.status(500).json({
      code: 500,
      msg: "服务器内部错误",
      data: null
    });
  });
}

module.exports = {
  registerExpRoutes
};
