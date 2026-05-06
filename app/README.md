# ExpGrade - 小学科学实验 AI 测评系统

## 1. 系统整体定位

ExpGrade 是一套面向小学科学实验教学的 **AI 智能测评系统**。系统通过 RTSP 摄像头实时采集学生实验操作画面，利用 YOLO 深度学习模型进行目标检测，自动识别实验器材及其状态，并根据预设的评分规则对实验完成度进行实时评分。

### 核心价值

- **自动化评分**：替代人工观察，实现实验操作的自动评分
- **实时反馈**：支持多路摄像头并行识别，提供实时实验进度反馈
- **灵活配置**：支持多种实验类型，通过配置文件即可扩展新实验
- **可视化展示**：直观展示各摄像头的识别结果和评分状态

---

## 2. 核心功能需求

### 2.1 前端功能

前端基于 **React 18 + Vite + Ant Design** 构建，提供以下核心功能：

#### 主要功能模块

| 功能模块       | 描述                                                       |
| -------------- | ---------------------------------------------------------- |
| **实验选择**   | 支持切换不同实验类型（小灯泡实验、吹气袋实验、斜坡模型等） |
| **摄像头管理** | 展示 12 路摄像头画面，支持放大/恢复视图                    |
| **实时识别**   | 单次识别或连续实时识别模式                                 |
| **评分展示**   | 显示各状态得分、总分、完成进度                             |
| **白名单过滤** | 支持仅对白名单摄像头进行识别                               |

#### 技术栈

```
- React 18           # 前端框架
- Vite 7             # 构建工具
- Ant Design 5       # UI 组件库
- Jotai              # 状态管理
- Axios              # HTTP 请求
- jsPDF              # PDF 导出
- xlsx               Excel 数据处理
- MQTT               # 消息订阅（预留）
```

#### 核心组件

- [`frontend/src/app/index/index.jsx`](frontend/src/app/index/index.jsx) - 主页面组件，包含摄像头网格展示、实验选择、识别控制
- [`frontend/src/component/Nav/index.jsx`](frontend/src/component/Nav/index.jsx) - 导航栏组件
- [`frontend/src/util/request.js`](frontend/src/util/request.js) - 封装的 HTTP 请求工具
- [`frontend/src/constant/apis.js`](frontend/src/constant/apis.js) - API 服务地址配置

---

### 2.2 后端服务器功能

后端基于 **Node.js + Express 5** 构建，提供以下核心功能：

#### 主要功能模块

| API 接口                  | 方法 | 描述                             |
| ------------------------- | ---- | -------------------------------- |
| `/api/experiments`        | GET  | 获取所有实验配置和摄像头列表     |
| `/api/experiments/select` | POST | 切换当前激活的实验模型           |
| `/api/analyze-cameras`    | POST | 批量分析摄像头画面并返回识别结果 |
| `/api/cameras`            | GET  | 获取摄像头配置列表               |
| `/api/settings`           | GET  | 获取系统设置                     |

#### 技术栈

```
- Express 5          # Web 框架
- WebSocket (ws)     # 实时通信（预留）
- Multer             # 文件上传处理
- Fluent-FFmpeg      # RTSP 流截图
- Axios              # HTTP 客户端（调用 Python AI 服务）
- CORS               # 跨域支持
```

#### 核心处理流程

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   RTSP 摄像头    │───▶│  FFmpeg 截帧     │───▶│  Python AI 服务 │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                                        │
                                                        ▼
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   前端展示结果   │◀───│  评分规则引擎     │◀───│  YOLO 目标检测  │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

#### 核心文件

- [`backend/experiment.js`](backend/experiment.js) - 主服务文件，包含：
  - 实验配置读取与管理
  - RTSP 流截图处理
  - 评分规则引擎
  - 累计分数记忆
  - 结果持久化

- [`backend/cameras.json`](backend/cameras.json) - 摄像头配置文件
- [`backend/experiments/`](backend/experiments/) - 实验配置目录

---

### 2.3 AI 模型调用

AI 服务基于 **Python + FastAPI + Ultralytics YOLO** 构建，提供目标检测能力。

#### 技术栈

```
- FastAPI            # 高性能 Web 框架
- Uvicorn            # ASGI 服务器
- Ultralytics YOLO   # 目标检测模型
- Pillow (PIL)       # 图像处理
```

#### API 接口

| 接口          | 方法 | 描述                               |
| ------------- | ---- | ---------------------------------- |
| `/health`     | GET  | 健康检查，返回当前加载的模型       |
| `/load-model` | POST | 动态加载/切换 YOLO 模型            |
| `/detect`     | POST | 执行目标检测，返回检测框和标注图像 |

#### 检测参数

```python
# detect 接口参数
image: UploadFile     # 待检测图像
conf: float = 0.65    # 置信度阈值
model_path: str       # 模型路径（可选，动态切换）
class_names: str      # 类别名称 JSON 数组
return_annotated: str # 是否返回标注图像
```

#### 预置模型

| 模型文件      | 实验类型   | 识别类别                                             |
| ------------- | ---------- | ---------------------------------------------------- |
| `best-el.pt`  | 小灯泡实验 | wire, battery, switch, lightbulb, lightbulbOrange 等 |
| `best-bag.pt` | 吹气袋实验 | Testbag, FoldedTestBag, Straw, ConnectedStraw        |
| `best-po.pt`  | 斜坡模型   | sphere, cube, prism, cuboid                          |

#### 核心文件

- [`backend/detect_server.py`](backend/detect_server.py) - Python AI 检测服务

---

## 3. 项目架构

```
app/
├── frontend/                    # 前端项目
│   ├── src/
│   │   ├── app/
│   │   │   ├── index/          # 主页面
│   │   │   └── store/          # 状态管理
│   │   ├── component/          # 公共组件
│   │   ├── constant/           # 常量配置
│   │   ├── img/                # 图片资源
│   │   └── util/               # 工具函数
│   ├── public/                 # 静态资源
│   ├── package.json
│   └── vite.config.js
│
├── backend/                     # 后端项目
│   ├── experiments/            # 实验配置目录
│   │   ├── defaultExperiment.json  # 小灯泡实验
│   │   ├── bagExperiment.json      # 吹气袋实验
│   │   └── poExperiment.json       # 斜坡模型实验
│   ├── capture/                # 截图保存目录
│   ├── results/                # 识别结果存储
│   ├── public/                 # 静态文件（构建产物）
│   ├── detect_server.py        # Python AI 服务
│   ├── experiment.js           # Node.js 主服务
│   ├── cameras.json            # 摄像头配置
│   ├── best-*.pt               # YOLO 模型文件
│   └── package.json
│
└── README.md
```

---

## 4. 实验配置说明

### 配置文件结构

```json
{
  "displayName": "实验名称",
  "description": "实验描述",
  "isDefault": true,
  "modelPath": "./best-el.pt",
  "classNames": ["class1", "class2"],
  "classNamesZn": ["类别1", "类别2"],
  "stateRules": {
    "state1": { "class1": 1, "class2": 2 },
    "state2": { "class3": 1 }
  },
  "scoreRules": [
    { "state": "state1", "score": 10 },
    { "state": "state2", "score": 10 }
  ]
}
```

### 字段说明

| 字段           | 类型     | 描述                                   |
| -------------- | -------- | -------------------------------------- |
| `displayName`  | string   | 实验显示名称                           |
| `modelPath`    | string   | YOLO 模型文件路径                      |
| `classNames`   | string[] | 模型识别的类别名称（英文）             |
| `classNamesZn` | string[] | 类别中文名称（用于展示）               |
| `stateRules`   | object   | 状态判定规则，定义各状态需要的器材数量 |
| `scoreRules`   | array    | 评分规则，定义各状态的分数             |

### 状态规则示例

```json
// 小灯泡实验状态规则
"stateRules": {
  "init": {
    "wire": 3,                      // 需要 3 根电线
    "switch｜switchConnected": 1,   // 需要 1 个开关（支持别名）
    "batteryComp": 1,
    "lightbulb": 1
  },
  "connect": {
    "switchConnected": 1,
    "batteryConnected": 1,
    "lightbulbConnected": 1
  },
  "finish": {
    "batteryConnected": 1,
    "lightbulbOrange": 1,           // 灯泡点亮
    "switchClosed": 1               // 开关闭合
  }
}
```

---

## 5. 快速开始

### 环境要求

- Node.js >= 18
- Python >= 3.8
- FFmpeg（用于 RTSP 流处理）

### 安装依赖

```bash
# 安装前端依赖
cd frontend
npm install

# 安装后端依赖
cd ../backend
npm install

# 安装 Python 依赖
pip install fastapi uvicorn ultralytics pillow
```

### 启动服务

```bash
# 1. 启动 Python AI 服务（端口 3008）
cd backend
python detect_server.py

# 2. 启动 Node.js 后端服务（端口 3001）
npm start

# 3. 启动前端开发服务器（端口 5173）
cd ../frontend
npm run dev
```

### 环境变量配置

```bash
# backend/.env
HTTP_PORT=3001
PYTHON_API=http://127.0.0.1:3008/detect
PYTHON_LOAD_MODEL_API=http://127.0.0.1:3008/load-model
FFMPEG_PATH=/opt/homebrew/bin/ffmpeg
SCREENSHOT_ENABLED=1
MIN_CAPTURE_WIDTH=640
MIN_CAPTURE_HEIGHT=360
```

---

## 6. 评分机制

### 累计评分

系统采用 **累计评分** 机制，即一旦某个状态达成，其分数将被保留，直到实验重置。

```javascript
// 评分流程
const scoreResult = applyCumulativeScore(experimentKey, cameraId, experiment, scoreExperiment(experiment, classCounts));
```

### 顺序评分

前端支持 **顺序评分** 模式，即必须按顺序完成各状态：

```javascript
// 前端顺序评分逻辑
const applySequentialScoring = (camera) => {
  let canEvaluateCurrent = true;
  const stateResults = sourceStates.map((state) => {
    if (!canEvaluateCurrent) {
      return { ...state, passed: false, blockedByPrevious: true };
    }
    canEvaluateCurrent = state.passed;
    return state;
  });
  return { ...camera, stateResults };
};
```

---

## 7. 摄像头配置

### 配置文件格式

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

### 字段说明

| 字段        | 类型    | 描述             |
| ----------- | ------- | ---------------- |
| `id`        | string  | 摄像头唯一标识   |
| `name`      | string  | 显示名称         |
| `rtspUrl`   | string  | RTSP 流地址      |
| `slot`      | number  | 位置槽位（1-12） |
| `whitelist` | boolean | 是否在白名单中   |

---

## 8. 开发指南

### 前端开发

```bash
cd frontend
npm run dev      # 开发模式
npm run build    # 生产构建
npm run preview  # 预览构建结果
```

### 后端开发

```bash
cd backend
npm start        # 启动服务
```

### 添加新实验

1. 训练 YOLO 模型，生成 `.pt` 文件
2. 在 `backend/experiments/` 目录创建配置文件
3. 重启后端服务，前端即可选择新实验

---

## 9. 技术亮点

1. **多路并行处理**：支持 12 路摄像头并行抓帧和识别
2. **动态模型切换**：无需重启服务即可切换不同实验模型
3. **累计评分记忆**：跨帧保持评分状态，避免瞬时识别波动
4. **轻量传输模式**：实时模式下可选择不传输图像，减少带宽占用
5. **RTSP 容错机制**：支持 TCP/UDP 双策略自动切换

---

## 10. 许可证

本项目仅供教育和研究使用。
