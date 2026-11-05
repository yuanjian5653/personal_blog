"use client";

/**
 * 统一缓存层。
 *
 * 历史：这里原本有**两套各自独立**的缓存实现 ——
 *   · lib/cache.ts           内存 + TTL（跨路由导航有效，刷新即失效）
 *   · lib/useCachedFetch.ts  sessionStorage + TTL（跨刷新也有效）
 * 两套各写一遍 TTL 判断、读写、过期处理，属于重复实现；改一处容易漏另一处。
 * 现在合并为：本文件持有**唯一的存储与 TTL 逻辑**，
 * useCachedFetch.ts 只保留一层很薄的 React Hook。
 *
 * 两层存储的分工（同一份 key，按需决定落哪层）：
 *   内存 Map         跨路由导航有效（SPA 切页时 JS 运行时还在）—— 命中零成本
 *   sessionStorage   跨页面刷新有效（同一标签页内）—— 首屏不闪
 *
 * 读：先内存，再 sessionStorage（命中会回填内存）
 * 写：persist=true 时两层都写，否则只写内存
 *
 * 注意：**不要在渲染期调用**（含 useState 的惰性初始化）。
 * 服务端渲染时没有 window、客户端首次渲染能读到缓存，两边结果不一致会触发
 * "Hydration failed"。只能在 effect 或事件回调里调用。
 */
import { api } from "./api";

/** 默认存活时间：1 分钟 */
export const DEFAULT_TTL = 60_000;

/** sessionStorage 的 key 前缀，避免和别的东西撞名 */
const SS_PREFIX = "dsh-cache:";

interface Entry {
  at: number;
  data: unknown;
}

/** 内存层：跨路由导航有效 */
const memory = new Map<string, Entry>();
/** 进行中的请求：同 key 并发调用只打一次 */
const inflight = new Map<string, Promise<unknown>>();

/* ---------------- sessionStorage 层（SSR 下自动 no-op） ---------------- */

function ssRead(key: string): Entry | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(SS_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Entry;
    if (typeof parsed?.at !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

function ssWrite(key: string, data: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      SS_PREFIX + key,
      JSON.stringify({ at: Date.now(), data })
    );
  } catch {
    // 隐私模式 / 配额满：忽略，内存层仍然可用
  }
}

function ssDelete(key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(SS_PREFIX + key);
  } catch {}
}

function ssClearAll(): void {
  if (typeof window === "undefined") return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < window.sessionStorage.length; i += 1) {
      const k = window.sessionStorage.key(i);
      if (k && k.startsWith(SS_PREFIX)) keys.push(k);
    }
    for (const k of keys) window.sessionStorage.removeItem(k);
  } catch {}
}

/* ---------------- 基础读写 ---------------- */

/**
 * 同步读一条缓存（过期视为未命中）。
 * persist=true 时还会查 sessionStorage，命中会回填内存。
 */
export function peekCached<T>(
  key: string,
  ttlMs = DEFAULT_TTL,
  persist = false
): T | null {
  // ttl <= 0 表示"不缓存"
  if (ttlMs <= 0) return null;

  const now = Date.now();

  const hit = memory.get(key);
  if (hit) {
    if (now - hit.at <= ttlMs) return hit.data as T;
    memory.delete(key);
  }

  if (!persist) return null;

  const ss = ssRead(key);
  if (ss && now - ss.at <= ttlMs) {
    memory.set(key, ss); // 回填内存，下���连 JSON 都不用再解析
    return ss.data as T;
  }

  return null;
}

/** 写入缓存。persist=true 时同时落 sessionStorage。 */
export function writeCached<T>(key: string, data: T, persist = false): void {
  memory.set(key, { at: Date.now(), data });
  if (persist) ssWrite(key, data);
}

/** 让某个 key 失效（内存 + sessionStorage 都清） */
export function invalidateCached(key: string): void {
  memory.delete(key);
  inflight.delete(key);
  ssDelete(key);
}

/** 清空所有缓存（内存 + 本项目写入的 sessionStorage 项） */
export function clearCachedGets(): void {
  memory.clear();
  inflight.clear();
  ssClearAll();
}

/* ---------------- 便捷接口：按 API 路径取数 ---------------- */

/**
 * 带缓存的 GET（只走内存层 —— 它是给"切页回来不重复请求"用的，
 * 刷新页面时重新请求反而更符合预期）。
 *
 * 命中缓存时立即 resolve；未命中则发请求，并做并发去重。
 */
export function cachedGet<T>(path: string, ttlMs = DEFAULT_TTL): Promise<T> {
  const hit = peekCached<T>(path, ttlMs);
  if (hit !== null) return Promise.resolve(hit);

  const running = inflight.get(path);
  if (running) return running as Promise<T>;

  const p = api
    .get<T>(path)
    .then((data) => {
      writeCached(path, data);
      return data;
    })
    .finally(() => {
      inflight.delete(path);
    });

  inflight.set(path, p);
  return p;
}
