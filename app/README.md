# ExpGrade - 小学科学 AI 实验识别系统

[![React](https://img.shields.io/badge/React-18-blue.svg)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-7-purple.svg)](https://vitejs.dev/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.100+-green.svg)](https://fastapi.tiangolo.com/)
[![YOLO](https://img.shields.io/badge/YOLO-Ultralytics-orange.svg)](https://ultralytics.com/)

基于 YOLO 目标检测的小学科学实验自动评分系统，支持多路摄像头实时识别实验器材状态并自动评分。

## 项目概述

ExpGrade 是一个智能化的实验评分系统，专为小学科学课堂设计。系统通过 RTSP 摄像头实时捕获学生实验操作画面，利用 YOLO 深度学习模型识别实验器材及其状态，根据预设的评分规则自动判定实验完成度和得分。

### 核心功能

- **多路视频监控**: 支持同时接入 12 路 RTSP 摄像头
- **实时目标检测**: 基于 YOLO 模型的实验器材识别（50ms 刷新间隔）
- **智能评分系统**: 根据器材连接状态自动判定实验完成度
- **实验配置管理**: 支持多种实验类型，可灵活配置评分规则
- **模型热切换**: 运行时动态加载不同 YOLO 模型，无需重启服务
- **可视化界面**: 直观展示各摄像头识别结果和评分状态
- **白名单模式**: 支持仅分析指定摄像头

## 技术栈

### 前端

| 技术         | 版本   | 用途         |
| ------------ | ------ | ------------ |
| React        | 18     | UI 框架      |
| Vite         | 7      | 构建工具     |
| Ant Design   | 5.x    | UI 组件库    |
| Jotai        | 2.x    | 状态管理     |
| React Router | 7.x    | 路由管理     |
| Less         | 4.x    | CSS 预处理器 |
| Axios        | 1.x    | HTTP 客户端  |
| MQTT         | 5.x    | 消息订阅     |
| jsPDF        | 3.x    | PDF 生成     |
| XLSX         | 0.18.x | Excel 处理   |

### 后端

| 技术      | 版本 | 用途       |
| --------- | ---- | ---------- |
| Node.js   | -    | 运行环境   |
| Express   | 5.x  | Web 框架   |
| WebSocket | 8.x  | 实时通信   |
| FFmpeg    | -    | 视频流处理 |
| Multer    | 2.x  | 文件上传   |
| CORS      | 2.x  | 跨域支持   |

### AI 服务

| 技术        | 版本 | 用途         |
| ----------- | ---- | ------------ |
| Python      | 3.x  | 运行环境     |
| FastAPI     | -    | API 框架     |
| Ultralytics | -    | YOLO 模型库  |
| PyTorch     | -    | 深度学习框架 |
| Pillow      | -    | 图像处理     |
| Uvicorn     | -    | ASGI 服务器  |

## 系统架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        前端 (React + Vite)                       │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │ 实验选择器    │  │ 摄像头面板    │  │    评分结果展示           │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
└───────────────────────────────┬─────────────────────────────────┘
                                │ HTTP/WebSocket
┌───────────────────────────────▼─────────────────────────────────┐
│                    后端服务 (Node.js + Express)                   │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │ 实验配置管理 │  │ 摄像头管理  │  │    评分逻辑处理         │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │ RTSP 视频流 │  │ FFmpeg 转码 │  │    WebSocket 推送       │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
└───────────────────────────────┬─────────────────────────────────┘
                                │ HTTP API
┌───────────────────────────────▼─────────────────────────────────┐
│                   AI 检测服务 (Python + FastAPI)                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │ YOLO 模型   │  │ 目标检测    │  │    模型热切换           │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## 项目结构

```
app/
├── backend/                      # 后端服务
│   ├── detect_server.py          # Python AI 检测服务 (Port 3000)
│   ├── experiment.js             # Node.js 主服务 (Port 3001)
│   ├── package.json              # Node.js 依赖配置
│   ├── cameras.json              # 摄像头配置
│   ├── best-el.pt                # YOLO 模型文件 (小灯泡实验)
│   ├── best-bag.pt               # YOLO 模型文件 (书包实验)
│   ├── experiments/              # 实验配置目录
│   │   ├── defaultExperiment.json    # 默认实验配置 (小灯泡实验)
│   │   └── bagExperiment.json        # 其他实验配置 (书包实验)
│   ├── capture/                  # 截图保存目录
│   │   ├── camera-X_raw.jpg      # 原始截图
│   │   ├── camera-X_annotated.jpg # 标注截图
│   │   └── camera-X_meta.json    # 元数据
│   └── public/                   # 静态资源
│       ├── config.json           # 前端配置
│       ├── index.html            # 管理页面
│       ├── index.css             # 样式文件
│       ├── index.js              # 前端逻辑
│       └── flv.min.js            # FLV 播放器
│
└── frontend/                     # 前端应用
    ├── src/
    │   ├── App.jsx               # 应用入口
    │   ├── main.jsx              # React 入口
    │   ├── index.less            # 全局样式
    │   ├── var.less              # 样式变量
    │   ├── app/
    │   │   ├── index/            # 主页面
    │   │   │   ├── index.jsx     # 页面组件 (12 路摄像头监控)
    │   │   │   └── index.less    # 样式文件
    │   │   └── store/            # 状态管理
    │   │       └── auth.js       # 认证状态
    │   ├── component/            # 公共组件
    │   │   └── Nav/              # 导航组件
    │   ├── constant/             # 常量定义
    │   │   ├── apis.js           # API 地址配置
    │   │   ├── data.js           # 静态数据
    │   │   └── urls.js           # URL 配置
    │   ├── img/                  # 图片资源
    │   └── util/                 # 工具函数
    │       ├── fn.js             # 通用函数
    │       ├── request.js        # HTTP 请求封装
    │       └── token.js          # Token 管理
    ├── public/                   # 静态资源
    │   ├── ans.svg               # 答案图标
    │   ├── city.json             # 城市数据
    │   ├── major.json            # 专业数据
    │   └── font/                 # 字体文件
    ├── vite.config.js            # Vite 配置
    ├── eslint.config.js          # ESLint 配置
    └── package.json              # 依赖配置
```

## 快速开始

### 环境要求

- Node.js >= 18
- Python >= 3.8
- FFmpeg (需添加到系统 PATH 或配置 `FFMPEG_PATH` 环境变量)

### 安装步骤

1. **克隆项目**

   ```bash
   git clone <repository-url>
   cd ExpGrade/app
   ```

2. **安装后端依赖**

   ```bash
   cd backend
   npm install
   pip install fastapi uvicorn ultralytics pillow
   ```

3. **安装前端依赖**

   ```bash
   cd ../frontend
   npm install
   ```

4. **配置摄像头**

   编辑 [`backend/cameras.json`](backend/cameras.json)，配置 RTSP 摄像头地址：

   ```json
   {
     "cameras": [
       {
         "id": "camera-1",
         "name": "摄像头 1",
         "rtspUrl": "rtsp://admin:password@192.168.1.10:554/Streaming/Channels/101",
         "slot": 1,
         "whitelist": true
       }
     ]
   }
   ```

5. **启动服务**

   **终端 1** - 启动 AI 检测服务：

   ```bash
   cd backend
   python detect_server.py
   # 服务运行在 http://localhost:3000
   ```

   **终端 2** - 启动后端服务：

   ```bash
   cd backend
   npm start
   # 服务运行在 http://localhost:3001
   ```

   **终端 3** - 启动前端开发服务器：

   ```bash
   cd frontend
   npm run dev
   # 服务运行在 http://localhost:5173
   ```

6. **访问应用**

   打开浏览器访问 `http://localhost:5173`

## 实验配置说明

### 实验配置文件结构

实验配置存放在 [`backend/experiments/`](backend/experiments/) 目录，每个 JSON 文件对应一个实验：

```json
{
  "displayName": "小灯泡实验",
  "description": "根据器材连接状态判定实验完成度",
  "isDefault": true,
  "modelPath": "./best-el.pt",
  "classNames": ["wire", "battery", "switch", "lightbulb", ...],
  "stateRules": {
    "init": { "wire": 3, "switch": 1, ... },
    "connect": { "switchConnected": 1, ... },
    "finish": { "lightbulbOrange": 1, ... }
  },
  "scoreRules": [
    { "state": "init", "score": 10 },
    { "state": "connect", "score": 10 },
    { "state": "finish", "score": 10 }
  ]
}
```

### 配置字段说明

| 字段          | 类型     | 说明               |
| ------------- | -------- | ------------------ |
| `displayName` | string   | 实验显示名称       |
| `description` | string   | 实验描述           |
| `isDefault`   | boolean  | 是否为默认实验     |
| `modelPath`   | string   | YOLO 模型文件路径  |
| `classNames`  | string[] | 可识别的器材类别   |
| `stateRules`  | object   | 各状态所需器材数量 |
| `scoreRules`  | array    | 各状态对应分数     |

### 评分逻辑

系统根据 `stateRules` 定义的状态序列，依次检查每个状态所需的器材是否满足数量要求：

1. **init 状态**: 检查初始器材是否齐全（如：3 根导线、1 个开关、1 个电池盒等）
2. **connect 状态**: 检查器材是否正确连接（如：开关已连接、电池已连接、灯泡已连接）
3. **finish 状态**: 检查实验是否完成（如：灯泡点亮、开关闭合）

每个状态通过后获得对应分数，总分自动累计。

### 内置实验示例

#### 小灯泡实验 ([`defaultExperiment.json`](backend/experiments/defaultExperiment.json))

- **模型**: `best-el.pt`
- **识别类别**: wire, battery, switch, batteryComp, lightbulb, lightbulbModel, switchConnected, batteryConnected, lightbulbConnected, lightbulbOrange, switchClosed
- **评分规则**:
  - init (10 分): 检查基础器材齐全
  - connect (10 分): 检查电路连接正确
  - finish (10 分): 检查灯泡点亮

#### 书包实验 ([`bagExperiment.json`](backend/experiments/bagExperiment.json))

- **模型**: `best-bag.pt`
- **识别类别**: bag, strap, zipper, tag
- **评分规则**:
  - init (10 分): 检查书包和背带
  - connect (10 分): 检查拉链
  - finish (10 分): 检查标签

## API 接口

### 后端服务 (Node.js - Port 3001)

| 方法 | 路径                  | 说明                     | 请求体                                      |
| ---- | --------------------- | ------------------------ | ------------------------------------------- |
| GET  | `/experiments`        | 获取实验列表和摄像头配置 | -                                           |
| POST | `/experiments/select` | 切换当前实验             | `{ experimentKey: string }`                 |
| POST | `/analyze-cameras`    | 分析所有摄像头画面       | `{ experimentKey, cameras, whitelistOnly }` |
| POST | `/upload-image`       | 上传图片进行检测         | `multipart/form-data` (image 文件)          |
| GET  | `/results/latest`     | 获取最新检测结果         | -                                           |
| GET  | `/results/history`    | 获取检测历史记录         | -                                           |

### AI 检测服务 (Python - Port 3000)

| 方法 | 路径          | 说明         | 请求体/参数                                                  |
| ---- | ------------- | ------------ | ------------------------------------------------------------ |
| GET  | `/health`     | 健康检查     | -                                                            |
| POST | `/load-model` | 加载指定模型 | `{ model_path: string, class_names: string[] }`              |
| POST | `/detect`     | 执行目标检测 | `image` (文件), `conf` (置信度), `model_path`, `class_names` |

## 开发指南

### 前端开发

```bash
cd frontend

# 启动开发服务器
npm run dev

# 构建生产版本
npm run build

# 预览生产版本
npm run preview

# 代码检查
npm run lint
```

### 后端开发

```bash
cd backend

# 启动 Node.js 服务
npm start

# 启动 Python 检测服务
python detect_server.py
```

### 环境变量

后端服务支持以下环境变量：

| 变量名                  | 默认值                           | 说明                  |
| ----------------------- | -------------------------------- | --------------------- |
| `HTTP_PORT`             | 3001                             | Node.js 服务端口      |
| `PYTHON_API`            | http://127.0.0.1:3000/detect     | Python 检测 API       |
| `PYTHON_LOAD_MODEL_API` | http://127.0.0.1:3000/load-model | 模型加载 API          |
| `FFMPEG_PATH`           | /opt/homebrew/bin/ffmpeg         | FFmpeg 可执行文件路径 |
| `MODEL_PATH`            | best-el.pt                       | 默认模型文件          |
| `MIN_CAPTURE_WIDTH`     | 640                              | 截图最小宽度          |
| `MIN_CAPTURE_HEIGHT`    | 360                              | 截图最小高度          |

前端环境变量 ([`.env`](frontend/.env)):

| 变量名            | 开发环境              | 生产环境                 |
| ----------------- | --------------------- | ------------------------ |
| `VITE_API_SERVER` | http://localhost:8888 | http://8.136.110.55:8888 |

## 技术亮点

1. **模型热切换**: 支持运行时动态加载不同的 YOLO 模型，通过模型缓存机制避免重复加载开销
2. **多路视频处理**: 使用 FFmpeg 高效处理多路 RTSP 视频流，支持截图和标注
3. **实时识别模式**: 50ms 间隔连续刷新，实时反馈实验状态
4. **灵活配置**: JSON 配置文件支持快速添加新实验类型，无需修改代码
5. **模型缓存**: 已加载模型自动缓存到 `MODEL_CACHE`，切换实验时无缝衔接
6. **白名单过滤**: 支持仅分析指定摄像头，提高检测效率
7. **摄像头聚焦**: 支持单摄像头放大查看，便于细节观察

## 核心代码逻辑

### 评分流程 ([`experiment.js`](backend/experiment.js:145))

```javascript
function scoreExperiment(experiment, classCounts = {}) {
  const stateRules = experiment?.stateRules || {};
  const scoreRules = experiment?.scoreRules || [];

  // 遍历每个评分规则，检查对应状态是否满足
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

    const passed = requirements.every((req) => req.passed);
    return {
      state: rule.state,
      score: rule.score,
      earnedScore: passed ? rule.score : 0,
      passed,
      requirements
    };
  });

  const totalScore = stateResults.reduce((sum, r) => sum + r.earnedScore, 0);
  const maxScore = stateResults.reduce((sum, r) => sum + r.score, 0);

  return { stateResults, totalScore, maxScore };
}
```

### 检测流程 ([`detect_server.py`](backend/detect_server.py:68))

```python
@app.post("/detect")
async def detect(
    image: UploadFile = File(...),
    conf: float = Form(0.25),
    model_path: str = Form(None),
    class_names: str = Form("[]")
):
    # 1. 加载或切换模型
    # 2. 使用 YOLO 模型进行目标检测
    # 3. 解析检测结果 (边界框、类别、置信度)
    # 4. 生成标注图像 (Base64 编码)
    # 5. 返回检测结果
```

### 实时识别模式 ([`index.jsx`](frontend/src/app/index/index.jsx:162))

```javascript
useEffect(() => {
  if (!isRealtime || !experimentKey) {
    return;
  }

  let stopped = false;
  const loop = async () => {
    while (!stopped) {
      await handleAnalyzeAll({ silent: true });
      if (stopped) break;
      await new Promise((resolve) => setTimeout(resolve, 50)); // 50ms 间隔
    }
  };
  loop();

  return () => {
    stopped = true;
  };
}, [isRealtime, experimentKey, handleAnalyzeAll]);
```

## 许可证

本项目仅供教育和研究目的使用。

## 贡献指南

欢迎提交 Issue 和 Pull Request。在提交代码前，请确保：

1. 代码通过 ESLint 检查
2. 新功能有相应的测试覆盖
3. 遵循现有的代码风格和命名规范
4. 更新相关文档说明
