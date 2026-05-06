const mode = import.meta.env.MODE;

// 根据构建环境切换后端地址。
var API_SERVER = "http://localhost:3001";

if (mode === "development") {
  API_SERVER = "http://localhost:3001";
}

if (mode === "production") {
  API_SERVER = "http://8.136.110.55:8888";
}

export { API_SERVER };
