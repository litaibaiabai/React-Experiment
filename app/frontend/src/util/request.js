// utils/request.js
import axios from "axios";
import { message } from "antd";

// 统一的请求实例，集中处理 baseURL、超时和凭证策略。
const service = axios.create({
  baseURL: process.env.NODE_ENV === "production" ? "/api" : "/dev-api", // 根据环境变量设置基础 URL
  timeout: 60000 * 5, // 请求超时时间
  withCredentials: false // 是否携带 cookie
});

// 为请求补齐默认请求头，并标记为 XHR 请求。
const handleRequestHeader = (config) => {
  // 设置默认 Content-Type
  if (!config.headers["Content-Type"]) {
    if (config.method === "post" || config.method === "POST") {
      config.headers["Content-Type"] = "application/json; charset=utf-8";
    } else {
      config.headers["Content-Type"] = "application/x-www-form-urlencoded;charset=UTF-8";
    }
  }

  // 其他自定义请求头处理
  config.headers["X-Requested-With"] = "XMLHttpRequest";

  return config;
};

// 从本地存储中取出 token，附加到 Authorization 头。
const handleAuth = (config) => {
  // 从 localStorage 获取 token
  const token = localStorage.getItem("AUTH_TOKEN") || sessionStorage.getItem("AUTH_TOKEN") || "";

  if (token) {
    config.headers["Authorization"] = `Bearer ${token}`;
  }

  return config;
};

// 统一翻译 HTTP 状态码，并在需要时跳转登录页。
const handleNetworkError = (errStatus, skipRedirect = false) => {
  let errMessage = "未知错误";

  if (errStatus) {
    switch (errStatus) {
      case 400:
        errMessage = "错误的请求";
        break;
      case 401:
        errMessage = "未授权，请重新登录";
        // 清除 token 并跳转到登录页（跳过重定向用于登录页）
        if (!skipRedirect) {
          localStorage.removeItem("AUTH_TOKEN");
          sessionStorage.removeItem("AUTH_TOKEN");
          window.location.href = "/login";
        }
        break;
      case 403:
        errMessage = "拒绝访问";
        break;
      case 404:
        errMessage = "请求错误，未找到该资源";
        break;
      case 405:
        errMessage = "请求方法未允许";
        break;
      case 408:
        errMessage = "请求超时";
        break;
      case 500:
        errMessage = "服务器端出错";
        break;
      case 501:
        errMessage = "网络未实现";
        break;
      case 502:
        errMessage = "网络错误";
        break;
      case 503:
        errMessage = "服务不可用";
        break;
      case 504:
        errMessage = "网络超时";
        break;
      case 505:
        errMessage = "HTTP 版本不支持该请求";
        break;
      default:
        errMessage = `其他连接错误 --${errStatus}`;
    }
  } else {
    errMessage = "无法连接到服务器！";
  }

  message.error(errMessage);
  return errMessage;
};

// 处理后端业务层的认证错误码。
const handleAuthError = (errno) => {
  const authErrMap = {
    10031: "登录失效，需要重新登录",
    10032: "您太久没登录，请重新登录~",
    10033: "账户未绑定角色，请联系管理员绑定角色",
    10034: "该用户未注册，请联系管理员注册用户",
    10035: "code 无法获取对应第三方平台用户",
    10036: "该账户未关联员工，请联系管理员做关联",
    10037: "账号已无效",
    10038: "账号未找到"
  };

  if (authErrMap[errno]) {
    message.error(authErrMap[errno]);
    // 授权错误，登出账户
    localStorage.removeItem("AUTH_TOKEN");
    sessionStorage.removeItem("AUTH_TOKEN");
    window.location.href = "/login";
    return false;
  }

  return true;
};

// 处理通用业务错误码，非 0 即视为失败。
const handleGeneralError = (errno, errmsg) => {
  if (errno !== "0" && errno !== 0) {
    message.error(errmsg || "操作失败");
    return false;
  }
  return true;
};

// 请求拦截器：统一补 header、写入 token。
service.interceptors.request.use(
  (config) => {
    // 在发送请求之前做些什么
    config = handleRequestHeader(config);
    config = handleAuth(config);

    // 显示 loading 动画（如果需要）
    // showLoading();

    return config;
  },
  (error) => {
    // 对请求错误做些什么
    console.error("请求配置错误:", error);
    return Promise.reject(error);
  }
);

// 响应拦截器：统一处理成功响应、HTTP 错误和业务错误。
service.interceptors.response.use(
  (response) => {
    // 隐藏 loading 动画（如果需要）
    // hideLoading();

    // 2xx 范围内的状态码都会触发该函数
    const { data, status } = response;

    if (status !== 200) {
      return Promise.reject(new Error("请求失败"));
    }

    // 处理业务错误码
    if (data.errno !== undefined) {
      handleAuthError(data.errno.toString());
      handleGeneralError(data.errno, data.errmsg);
    }

    return data;
  },
  (error) => {
    // 隐藏 loading 动画（如果需要）
    // hideLoading();

    // 超出 2xx 范围的状态码都会触发该函数
    if (error.response) {
      // 请求已发出，但服务器响应的状态码不在 2xx 范围内
      // 401 错误不在此处处理，由调用方自行处理（如登录页）
      if (error.response.status === 401) {
        // 只返回错误信息，不自动跳转
        const errMsg = error.response.data?.message || "账号或密码错误";
        message.error(errMsg);
        return Promise.reject(new Error(errMsg));
      }
      handleNetworkError(error.response.status);
    } else {
      // 请求未发出，如网络错误、超时等
      message.error("网络异常，请检查您的网络连接");
    }

    return Promise.reject(error);
  }
);

// 保留一个通用入口，方便特殊请求直接透传 axios 配置。
const request = (options) => {
  return service(options);
};

// GET 请求封装。
const get = (url, params = {}, config = {}) => {
  return service({
    method: "get",
    url,
    params,
    ...config
  });
};

// POST 请求封装。
const post = (url, data = {}, config = {}) => {
  return service({
    method: "post",
    url,
    data,
    ...config
  });
};

// PUT 请求封装。
const put = (url, data = {}, config = {}) => {
  return service({
    method: "put",
    url,
    data,
    ...config
  });
};

// DELETE 请求封装。
const del = (url, params = {}, config = {}) => {
  return service({
    method: "delete",
    url,
    params,
    ...config
  });
};

// 文件上传请求封装，固定 multipart/form-data 头。
const upload = (url, formData, config = {}) => {
  return service({
    method: "post",
    url,
    data: formData,
    headers: {
      "Content-Type": "multipart/form-data"
    },
    ...config
  });
};

export default service;
export { request, get, post, put, del, upload, handleNetworkError, handleAuthError, handleGeneralError };
