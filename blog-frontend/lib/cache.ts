/**
 * 极简的模块级 GET 缓存。
 *
 * 为什么需要：
 *   App Router 切换路由会卸载页面组件，切回来时 useEffect 又跑一遍，
 *   于是每次都重新请求 —— 音乐页的播放列表、首页个人卡片的统计数字
 *   都会"每次回来转一圈"。这些数据几秒内根本不会变。
 *
 * 特点：
 *   · 内存驻留 —— 刷新浏览器即失效，不会读到跨会话的过期数据
 *   · 并发去重 —— 同一 path 同时发起多次只打一个请求
 *   · TTL 可配 —— 统计类数据用短 TTL，歌单类用长 TTL
 *
 * 注意：不要在渲染期用它做首帧直出（会和 SSR 结果不一致导致水合告警）。
 * 只在 useEffect 里调用；缓存命中时 Promise 会在微任务里就 resolve，
 * 所以"加载中"只闪一帧，不会有网络往返。
 */
import { api } from "./api";

interface Entry {
  at: number;
  data: unknown;
}

const store = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();

/** 默认存活时间：1 分钟 */
export const DEFAULT_TTL = 60_000;

/** 同步读缓存（过期视为未命中）。用于事件处理器或调试，不用于首帧渲染。 */
export function peekCached<T>(path: string, ttlMs = DEFAULT_TTL): T | null {
  // ttl <= 0 表示"不缓存"
  if (ttlMs <= 0) return null;

  const hit = store.get(path);
  if (!hit) return null;
  if (Date.now() - hit.at > ttlMs) return null;
  return hit.data as T;
}

/**
 * 带缓存的 GET。
 * 命中缓存时立即 resolve；未命中则发请求并写入缓存。
 */
export function cachedGet<T>(path: string, ttlMs = DEFAULT_TTL): Promise<T> {
  const hit = peekCached<T>(path, ttlMs);
  if (hit !== null) return Promise.resolve(hit);

  const running = inflight.get(path);
  if (running) return running as Promise<T>;

  const p = api
    .get<T>(path)
    .then((data) => {
      store.set(path, { at: Date.now(), data });
      return data;
    })
    .finally(() => {
      inflight.delete(path);
    });

  inflight.set(path, p);
  return p;
}

/** 让某个 path 的缓存失效（后台改动后想让前台立刻刷新时用） */
export function invalidateCached(path: string): void {
  store.delete(path);
  inflight.delete(path);
}

/** 清空整个缓存 */
export function clearCachedGets(): void {
  store.clear();
  inflight.clear();
}
