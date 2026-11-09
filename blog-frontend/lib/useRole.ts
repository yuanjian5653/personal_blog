"use client";

import { useSyncExternalStore } from "react";

/**
 * 当前后台账号的角色。
 *
 * 为什么单独做一个 hook：
 *   后台的几个列表页都要判断"是不是成员"来决定是否加 mine=1。
 *   角色来自 /api/auth/me，但那个请求在 AdminLayout 里已经发过一次了。
 *   这里把结果缓存到一个模块级变量里，任何页面都能同步读到，不重复请求。
 *
 * 默认值给 "admin"：读不到时不加限制（宁可在后台多看到内容，
 * 也不要因为一次请求失败让管理员看不见自己的数据）。
 */

export type Role = "admin" | "member";

let current: Role = "admin";
let snapshot = "admin";

function subscribe(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("role-change", cb);
  return () => window.removeEventListener("role-change", cb);
}

function getSnapshot(): string {
  return snapshot;
}

function getServerSnapshot(): string {
  return "admin";
}

/** AdminLayout 拿到 /api/auth/me 之后调用 */
export function setRole(role: Role | undefined): void {
  const next = role === "member" ? "member" : "admin";
  if (next === current) return;
  current = next;
  snapshot = next;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("role-change"));
  }
}

export function getRole(): Role {
  return current;
}

/**
 * 成员身份时给 URL 加上 mine=1（后台列表只看自己的）。
 *
 * 由这个函数自己判断该用 ? 还是 & —— 调用方只要把原始 URL 传进来，
 * 不用关心有没有已有参数。管理员身份原样返回。
 */
export function withMine(url: string): string {
  if (current !== "member") return url;
  return url + (url.includes("?") ? "&" : "?") + "mine=1";
}

export function useRole(): Role {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot) as Role;
}
