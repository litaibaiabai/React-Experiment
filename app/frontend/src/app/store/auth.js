import { atom } from "jotai";

// 登录状态原子。
export const isLoginAtom = atom(false);

// 当前用户信息原子。
export const currentUserAtom = atom(null);

// 用户积分原子。
export const userPointsAtom = atom(0);
