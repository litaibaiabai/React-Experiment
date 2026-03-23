const express = require("express");
const cors = require("cors");
const path = require("path");
const https = require("https");
const fs = require("fs");
const http = require("http");
const multer = require("multer");
const axios = require("axios");
const FormData = require("form-data");

const app = express();

// const PORT = 8088;
const HTTP_PORT = 80;

// Python 推理服务地址
const PYTHON_API = "http://127.0.0.1:8000/detect";

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
app.post("/api/detect", upload.single("image"), async (req, res, next) => {
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

http.createServer(app).listen(HTTP_PORT, () => {
  console.log(`HTTP 后端服务器已启动，运行在端口 ${HTTP_PORT}`);
});

// https.createServer(sslOptions, app).listen(PORT, () => {
//   console.log(`HTTPS 后端服务器已启动，运行在端口 ${PORT}`);
// });
