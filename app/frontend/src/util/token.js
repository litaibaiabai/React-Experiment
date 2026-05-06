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

// 统一封装 token 和用户信息的本地存储操作。
const USER_KEY = "APP_USER";
const TOKEN_KEY = "AUTH_TOKEN";

const token = {
  // 保存用户对象，并同步写入 token。
  saveUser(user) {
    if (!user) return;
    try {
      localStorage.setItem(USER_KEY, JSON.stringify(user));
      if (user.token) localStorage.setItem(TOKEN_KEY, user.token);
    } catch (e) {
      console.error("保存用户信息失败：", e);
    }
  },

  // 读取当前缓存的用户对象。
  loadUser() {
    try {
      const u = localStorage.getItem(USER_KEY);
      return u ? JSON.parse(u) : null;
    } catch (e) {
      console.error("读取用户信息失败：", e);
      return null;
    }
  },

  // 读取当前 token。
  get() {
    return localStorage.getItem(TOKEN_KEY);
  },

  // 清空用户和 token 缓存。
  clear() {
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(TOKEN_KEY);
  }
};

export default token;
