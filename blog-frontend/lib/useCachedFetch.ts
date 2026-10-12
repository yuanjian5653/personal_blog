"use client";

import { useEffect, useRef, useState } from "react";

/** sessionStorage 里的缓存结构 */
interface CacheEntry<T> {
  value: T;
  ts: number;
}

/**
 * 从 sessionStorage 同步读一条有效缓存。
 *
 * 关键：这个函数在 **useState 的惰性初始化**里调用，而不是在 useEffect 里。
 * 原来的写法是在 effect 里 setData/setLoading，那会导致：
 *   1. 首屏先用 null 渲染一帧，再被缓存覆盖（闪一下）
 *   2. 触发 react-hooks/set-state-in-effect 警告（effect 里同步 setState）
 * 放到初始化函数里就没有这两个问题——缓存命中时第一帧就是数据。
 *
 * SSR 时 window 不存在，直接返回 undefined，服务端与客户端首帧一致，
 * 不会产生 hydration mismatch。
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
 * 带缓存的 fetch Hook
 * - 命中 sessionStorage 缓存时首帧直接出数据，切换页面不闪烁
 * - 命中缓存也会在后台静默刷新一次
 * - 未命中则请求接口
 */
export function useCachedFetch<T>(
  cacheKey: string,
  fetcher: () => Promise<T>,
  ttlMs: number = 5 * 60 * 1000
): { data: T | null; loading: boolean } {
  const [data, setData] = useState<T | null>(() => readCache<T>(cacheKey, ttlMs) ?? null);

  // 把 fetcher 放进 ref，这样调用方每次渲染传新函数也不会重跑 effect。
  // 注意：ref 赋值必须放在 effect 里（渲染期读写 ref 会被 react-hooks/refs 拦下）。
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  useEffect(() => {
    let cancelled = false;

    // 缓存命中与否都请求一次（命中时是后台静默刷新）
    fetcherRef
      .current()
      .then((fresh) => {
        if (cancelled) return;
        setData(fresh);
        writeCache(cacheKey, fresh);
      })
      .catch(() => {
        // 请求失败：若已有缓存就继续用缓存，否则保持 null（由 loading 派生）
      });

    return () => {
      cancelled = true;
    };
  }, [cacheKey, ttlMs]);

  // loading 由 data 派生，不再单独维护一个状态
  return { data, loading: data === null };
}

/** 手动清空一个缓存 key */
export function clearCache(cacheKey: string) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(cacheKey);
  } catch {}
}
