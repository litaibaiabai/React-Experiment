// const TOKEN_KEY = "ANSSYS_TOKEN";
// const USER_KEY = "ANSSYS_USER";

// export const getToken = () => {
//   return window.localStorage.getItem(TOKEN_KEY);
// };

// export const removeUser = () => {
//   window.localStorage.removeItem(USER_KEY);
// };

// export const loadUser = () => {
//   return JSON.parse(window.localStorage.getItem(USER_KEY));
// };

// export const saveUser = (data) => {
//   window.localStorage.setItem(USER_KEY, JSON.stringify(data));
// };

// export default { loadUser, saveUser, removeUser, getToken };

// 简单封装 token / 用户信息存储（可放 localStorage 或 sessionStorage）

const USER_KEY = "APP_USER";
const TOKEN_KEY = "AUTH_TOKEN";

const token = {
  saveUser(user) {
    if (!user) return;
    try {
      localStorage.setItem(USER_KEY, JSON.stringify(user));
      if (user.token) localStorage.setItem(TOKEN_KEY, user.token);
    } catch (e) {
      console.error("保存用户信息失败：", e);
    }
  },

  loadUser() {
    try {
      const u = localStorage.getItem(USER_KEY);
      return u ? JSON.parse(u) : null;
    } catch (e) {
      console.error("读取用户信息失败：", e);
      return null;
    }
  },

  get() {
    return localStorage.getItem(TOKEN_KEY);
  },

  clear() {
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(TOKEN_KEY);
  }
};

export default token;
