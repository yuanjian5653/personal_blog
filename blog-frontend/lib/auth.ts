import { api } from "./api";
import type { AdminInfo } from "./types";

/** 获取当前登录管理员信息；未登录返回 null */
export async function fetchCurrentAdmin(): Promise<AdminInfo | null> {
  try {
    return await api.get<AdminInfo>("/api/auth/me");
  } catch {
    return null;
  }
}

/** 登录 */
export async function login(username: string, password: string) {
  return api.post<{ message: string; admin: AdminInfo }>(
    "/api/auth/login",
    { username, password }
  );
}

/** 登出 */
export async function logout() {
  return api.post<{ message: string }>("/api/auth/logout");
}