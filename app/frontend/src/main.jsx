import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";

import "./index.less";
import "./var.less";

// 挂载 React 根节点，加载全局样式后渲染应用。
createRoot(document.getElementById("root")).render(<App />);
