"use client";

import { useEffect, useRef, useState } from "react";

/** sessionStorage 里的缓存结构 */
interface CacheEntry<T> {
  value: T;
  ts: number;
}

/**
 * 从 sessionStorage 读一条有效缓存。
 *
 * ⚠️ 只能在 effect（或事件回调）里调用，**绝不能在渲染期调用** ——
 * 包括 useState 的惰性初始化函数。原因：
 *   服务端渲染时 window 不存在 → 返回 undefined
 *   客户端"首次"渲染时 window 已存在 → 能读到缓存
 * 两边 html 不一致，React 就会报
 * "Hydration failed because the server rendered HTML didn't match the client"。
 * （之前就是踩了这个坑：把读缓存放进惰性初始化，导致首页 PhotosCard、
 *   ProfileCard 出现 hydration 失败。）
 */
function readCache<T>(key: string, ttlMs: number): T | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return undefined;
    const cached = JSON.parse(raw) as CacheEntry<T>;
    if (Date.now() - cached.ts < ttlMs) return cached.value;
  } catch {}
  return undefined;
}

function writeCache<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(key, JSON.stringify({ value, ts: Date.now() }));
  } catch {}
}

/**
 * 带缓存的 fetch Hook。
 *
 * 1. 首帧固定 data=null（服务端与客户端首帧一致 → hydration 安全）
 * 2. 挂载后立刻用 sessionStorage 缓存填充，命中缓存时不必等网络
 * 3. 随后请求接口，拿到新数据覆盖并写回缓存（命中缓存时相当于静默刷新）
 *
 * loading 由 data 派生，不单独维护状态。
 */
export function useCachedFetch<T>(
  cacheKey: string,
  fetcher: () => Promise<T>,
  ttlMs: number = 5 * 60 * 1000
): { data: T | null; loading: boolean } {
  const [data, setData] = useState<T | null>(null);

  // fetcher 放进 ref，避免调用方每次渲染传新函数导致 effect 重跑。
  // ref 赋值必须放在 effect 里（渲染期读写 ref 会被 react-hooks/refs 拦下）。
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  useEffect(() => {
    let cancelled = false;

    // 1. 先用缓存快速填充，避免骨架屏停留太久。
    //    这里是**故意**同步 setState：命中缓存时希望在"挂载后的第一时间"
    //    就出数据（等一个 tick 会多闪一帧骨架）。它不会循环触发，
    //    因为依赖是 [cacheKey, ttlMs]，不会因 data 变化而重跑。
    const cached = readCache<T>(cacheKey, ttlMs);
    if (cached !== undefined) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 见上：一次性填充缓存，非派生数据
      setData(cached);
    }

    // 2. 再请求接口
    fetcherRef
      .current()
      .then((fresh) => {
        if (cancelled) return;
        setData(fresh);
        writeCache(cacheKey, fresh);
      })
      .catch(() => {
        // 请求失败：有缓存就继续用缓存，否则保持 null（由 loading 派生）
      });

    return () => {
      cancelled = true;
    };
  }, [cacheKey, ttlMs]);

  return { data, loading: data === null };
}

/** 手动清空一个缓存 key */
export function clearCache(cacheKey: string) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(cacheKey);
  } catch {}
}
