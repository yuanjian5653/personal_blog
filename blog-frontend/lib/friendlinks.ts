"use client";

import { api, withApiBase } from "./api";

/** 一条友链 */
export interface FriendLink {
  id: number;
  name: string;
  url: string;
  category: string | null;
  description: string | null;
  cover: string | null;
  weight: number;
  is_visible: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export type FriendLinkInput = Omit<
  FriendLink,
  "id" | "created_at" | "updated_at"
>;

/** 前台列表（只含可见的，已按权重倒序） */
export function fetchFriendLinks(): Promise<FriendLink[]> {
  return api.get<FriendLink[]>("/api/friend-links");
}

/** 后台列表（含不可见） */
export function fetchAllFriendLinks(): Promise<FriendLink[]> {
  return api.get<FriendLink[]>("/api/friend-links/all");
}

export function createFriendLink(
  data: Partial<FriendLinkInput>
): Promise<FriendLink> {
  return api.post<FriendLink>("/api/friend-links", data);
}

export function updateFriendLink(
  id: number,
  data: Partial<FriendLinkInput>
): Promise<FriendLink> {
  return api.put<FriendLink>(`/api/friend-links/${id}`, data);
}

export function deleteFriendLink(id: number): Promise<{ message: string }> {
  return api.delete<{ message: string }>(`/api/friend-links/${id}`);
}

/** 上传封面，返回可直接存进 cover 字段的相对路径 */
export async function uploadFriendCover(file: File): Promise<string> {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch(withApiBase("/api/friend-links/upload-cover"), {
    method: "POST",
    body: fd,
    credentials: "include",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `上传失败 (${res.status})`);
  }
  const data = (await res.json()) as { path: string };
  return data.path;
}

/**
 * 权重 → 卡片视觉尺寸。
 *
 * 权重可以为负，所以先按当前列表的 min/max 归一化到 0..1，再映射到尺寸区间。
 * 这样做的好处：不管你把权重写成 0~10 还是 0~1000，视觉分布都一样，
 * 不用去猜"该填多少"。
 */
export function weightToScale(
  weight: number,
  min: number,
  max: number
): number {
  // 全部同权重时全部取中间尺寸，避免除零
  const t = max === min ? 0.5 : (weight - min) / (max - min);
  return Math.min(1, Math.max(0, t));
}

/** 归一化后的 t（0..1）映射到卡片直径（px） */
export function scaleToDiameter(t: number): number {
  const MIN_D = 96;
  const MAX_D = 200;
  return MIN_D + (MAX_D - MIN_D) * t;
}

/** 从 URL 里取主机名，用于在卡片上显示 */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** 取首字母作为没有封面时的占位符 */
export function initialOf(name: string): string {
  const s = name.trim();
  if (!s) return "?";
  // 中文取第一个字，英文取第一个字母并大写
  return /[a-zA-Z]/.test(s[0]) ? s[0].toUpperCase() : s[0];
}

/** 由 id 生成稳定的伪随机数（0..1），用于随机初始位置而不破坏 hydration */
export function seededRandom(id: number, salt = 0): number {
  const x = Math.sin(id * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}
