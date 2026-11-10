"use client";

import { useSyncExternalStore } from "react";

/**
 * 作者表（内容作者徽章用）。
 *
 * 为什么单独做一个模块：
 *   内容列表接口只返回 author_id，显示名和头像需要另一份映射。
 *   如果每个卡片自己去查，一个列表页就是 N 次请求（N+1）。
 *   这里做一次请求 + 全局缓存，所有卡片共用。
 *
 * 缓存不加过期：作者名/角色几乎不变；改名后刷新页面即可看到。
 * 需要主动刷新时可以调用 invalidateAuthors()。
 */

export interface Author {
  id: number;
  name: string;
  avatar: string | null;
  is_admin: boolean;
  has_content: boolean;
  // 关于页里的资料（文章详情的作者卡片要用）
  bio: string | null;
  social_github: string | null;
  social_email: string | null;
  social_telegram: string | null;
  social_discord: string | null;
  is_public: boolean;
}

let cache: Author[] | null = null;
let inflight: Promise<Author[]> | null = null;
let snapshot: Map<number, Author> = new Map();

const EMPTY: Map<number, Author> = new Map();

function subscribe(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("authors-change", cb);
  return () => window.removeEventListener("authors-change", cb);
}

function emit() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("authors-change"));
  }
}

/** 同步返回快照给 useSyncExternalStore —— 引用必须稳定，所以只在数据变化时重建 */
function getSnapshot(): Map<number, Author> {
  if (typeof window === "undefined") return EMPTY;
  if (cache === null && inflight === null) {
    // 首次访问：发起加载，加载完成后 emit 触发重渲染
    void loadAuthors();
  }
  return snapshot;
}

function getServerSnapshot(): Map<number, Author> {
  return EMPTY;
}

export function loadAuthors(force = false): Promise<Author[]> {
  if (typeof window === "undefined") return Promise.resolve([]);
  if (cache && !force) return Promise.resolve(cache);
  if (inflight && !force) return inflight;

  inflight = fetch(`${process.env.NEXT_PUBLIC_API_BASE ?? ""}/api/authors`, {
    credentials: "include",
  })
    .then((r) => (r.ok ? r.json() : []))
    .then((rows: Author[]) => {
      cache = rows;
      const next = new Map<number, Author>();
      for (const a of rows) next.set(a.id, a);
      snapshot = next;
      inflight = null;
      emit();
      return rows;
    })
    .catch(() => {
      cache = [];
      snapshot = new Map();
      inflight = null;
      emit();
      return [];
    });

  return inflight;
}

/** 强制下次重新拉取（比如改了显示名之后） */
export function invalidateAuthors(): void {
  cache = null;
  inflight = null;
}

/** React 组件里用：返回 id → 作者的映射 */
export function useAuthors(): Map<number, Author> {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
