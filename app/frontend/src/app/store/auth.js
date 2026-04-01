import { atom } from "jotai";

// 是否已登录
export const isLoginAtom = atom(false);

// 当前用户信息
export const currentUserAtom = atom(null);

// 用户积分
export const userPointsAtom = atom(0);
