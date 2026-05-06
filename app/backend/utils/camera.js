const path = require("path");
const fs = require("fs");
const axios = require("axios");
const FormData = require("form-data");
const WebSocket = require("ws");
const ffmpeg = require("fluent-ffmpeg");

const ffmpegPath = process.env.FFMPEG_PATH || "/opt/homebrew/bin/ffmpeg";
ffmpeg.setFfmpegPath(ffmpegPath);

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

function checkResolution(buffer, minWidth, minHeight) {
  const resolution = getJpegDimensions(buffer);
  if (!resolution) {
    return {
      width: 0,
      height: 0,
      minWidth,
      minHeight,
      ok: false
    };
  }

  return {
    width: resolution.width,
    height: resolution.height,
    minWidth,
    minHeight,
    ok: resolution.width >= minWidth && resolution.height >= minHeight
  };
}

async function persistCaptureImages(captureDir, cameraId, rawBuffer, annotatedImageBase64, resolutionCheck) {
  try {
    await fs.promises.mkdir(captureDir, { recursive: true });
    const safeCameraId = (cameraId || "camera").replace(/[^a-zA-Z0-9_-]/g, "_");
    const rawPath = path.join(captureDir, `${safeCameraId}_raw.jpg`);
    const annotatedPath = path.join(captureDir, `${safeCameraId}_annotated.jpg`);
    const metaPath = path.join(captureDir, `${safeCameraId}_meta.json`);

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

function persistCaptureImagesNonBlocking(options) {
  const {
    screenshotEnabled,
    cameraLastCaptureSaveAt,
    captureSaveIntervalMs,
    captureDir,
    cameraId,
    rawBuffer,
    annotatedImageBase64,
    resolutionCheck
  } = options;
  if (!screenshotEnabled) {
    return;
  }

  const key = cameraId || "camera";
  const now = Date.now();
  const lastSaveAt = cameraLastCaptureSaveAt.get(key) || 0;
  if (now - lastSaveAt < captureSaveIntervalMs) {
    return;
  }
  cameraLastCaptureSaveAt.set(key, now);
  void persistCaptureImages(captureDir, cameraId, rawBuffer, annotatedImageBase64, resolutionCheck);
}

async function detectByBuffer(imageBuffer, experiment, conf, options = {}) {
  const { returnAnnotated = true, pythonApi } = options;
  const form = new FormData();
  form.append("image", imageBuffer, {
    filename: "frame.jpg",
    contentType: "image/jpeg"
  });
  form.append("conf", String(conf));
  form.append("model_path", experiment.modelPath);
  form.append("class_names", JSON.stringify(experiment.classNames || []));
  form.append("return_annotated", returnAnnotated ? "1" : "0");

  const response = await axios.post(pythonApi, form, {
    headers: form.getHeaders(),
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    timeout: 30000
  });

  return response.data;
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

async function captureOneCamera(camera) {
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

async function detectOneCamera(captured, experiment, conf, services, options = {}) {
  const { includeImage = true } = options;
  const {
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
  } = services;
  const { camera, ok, error, frameBuffer } = captured;
  if (!ok || !frameBuffer) {
    const cumulativeScore = getCumulativeScoreSnapshot(cumulativeScoreMemory, experiment.key, camera.id, experiment);
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
    const resolutionCheck = checkResolution(frameBuffer, minCaptureWidth, minCaptureHeight);
    const detectResult = await Promise.race([
      detectByBuffer(frameBuffer, experiment, conf, { returnAnnotated: includeImage, pythonApi }),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error("单路识别超时")), 8000);
      })
    ]);
    persistCaptureImagesNonBlocking({
      screenshotEnabled,
      cameraLastCaptureSaveAt,
      captureSaveIntervalMs,
      captureDir,
      cameraId: camera.id,
      rawBuffer: frameBuffer,
      annotatedImageBase64: detectResult.annotatedImageBase64 || null,
      resolutionCheck
    });
    const boxes = detectResult.boxes || [];
    const classCounts = buildClassCounts(boxes);
    const scoreResult = applyCumulativeScore(
      cumulativeScoreMemory,
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
    const resolutionCheck = checkResolution(frameBuffer, minCaptureWidth, minCaptureHeight);
    persistCaptureImagesNonBlocking({
      screenshotEnabled,
      cameraLastCaptureSaveAt,
      captureSaveIntervalMs,
      captureDir,
      cameraId: camera.id,
      rawBuffer: frameBuffer,
      annotatedImageBase64: null,
      resolutionCheck
    });
    const cumulativeScore = getCumulativeScoreSnapshot(cumulativeScoreMemory, experiment.key, camera.id, experiment);
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

module.exports = {
  getJpegDimensions,
  checkResolution,
  persistCaptureImages,
  persistCaptureImagesNonBlocking,
  detectByBuffer,
  safeKill,
  captureRtspFrameWithStrategy,
  captureRtspFrame,
  captureOneCamera,
  detectOneCamera,
  createRtspFlvStream
};
