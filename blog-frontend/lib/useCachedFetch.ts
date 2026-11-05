"use client";

import { useEffect, useRef, useState } from "react";

import { peekCached, writeCached } from "./cache";

/**
 * 带缓存的 fetch Hook。
 *
 * 存储与 TTL 逻辑都在 lib/cache.ts（与 cachedGet 共用同一套实现），
 * 这里只负责把"读取 → 请求 → 覆盖"这条时序接到 React 上。
 *
 * 行为：
 *   1. 首帧固定 data=null（服务端与客户端首帧一致 → hydration 安全）
 *   2. 挂载后用 sessionStorage 缓存填充，命中缓存时不必等网络
 *   3. 随后请求接口，拿到新数据覆盖并写回缓存（相当于静默刷新）
 *
 * loading 由 data 派生，不单独维护状态。
 *
 * 注意：缓存读取**只能**放在 effect 里，不能放进 useState 的惰性初始化 ——
 * 服务端没有 window、客户端首次渲染能读到，两边 html 不一致会触发
 * "Hydration failed"（之前踩过：首页 PhotosCard / ProfileCard）。
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
    const cached = peekCached<T>(cacheKey, ttlMs, true);
    if (cached !== null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 见上：一次性填充缓存，非派生数据
      setData(cached);
    }

    // 2. 再请求接口（失败时有缓存就继续用缓存，否则保持 null）
    fetcherRef
      .current()
      .then((fresh) => {
        if (cancelled) return;
        setData(fresh);
        writeCached(cacheKey, fresh, true);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [cacheKey, ttlMs]);

  return { data, loading: data === null };
}
