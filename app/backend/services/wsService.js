const WebSocket = require("ws");
const url = require("url");
const { safeKill, createRtspFlvStream } = require("../utils/camera");

// 创建 RTSP -> FLV 的 WebSocket 服务，并挂载到给定 HTTP server。
function createRtspWebSocketServer(server) {
  const wss = new WebSocket.Server({
    server,
    path: "/ws/rtsp",
    perMessageDeflate: false
  });

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

  return wss;
}

module.exports = {
  createRtspWebSocketServer
};
