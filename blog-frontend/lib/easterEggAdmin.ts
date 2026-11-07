"use client";

/**
 * 暗号彩蛋的后台接口封装。
 *
 * 与前台的差别：这里能拿到 code（暗号本身），
 * 前台的校验接口刻意只回"对不对"。
 */
import { api } from "./api";

export type EggKind = "background" | "game";
export type EggTransition = "fade" | "zoom" | "slide" | "blur";
export type AssetKind = "video" | "image";

export interface EasterEggRow {
  id: number;
  code: string;
  name: string;
  hint: string | null;
  kind: EggKind;
  asset_path: string | null;
  asset_kind: AssetKind | null;
  transition: EggTransition;
  is_enabled: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface EasterEggInput {
  code: string;
  name: string;
  hint: string;
  kind: EggKind;
  asset_path: string;
  asset_kind: AssetKind | null;
  transition: EggTransition;
  is_enabled: boolean;
  sort_order: number;
}

export const KIND_LABEL: Record<EggKind, string> = {
  background: "动态背景",
  game: "小游戏",
};

export const KIND_HINT: Record<EggKind, string> = {
  background: "用后台上传的动态壁纸铺满背景。没上传壁纸时不会有效果",
  game: "目前是「接星星」小游戏",
};

export const TRANSITION_LABEL: Record<EggTransition, string> = {
  fade: "淡入",
  zoom: "缩放推近",
  slide: "自下推入",
  blur: "模糊转清晰",
};

export function emptyEggInput(): EasterEggInput {
  return {
    code: "",
    name: "",
    hint: "",
    kind: "background",
    asset_path: "",
    asset_kind: null,
    transition: "fade",
    is_enabled: true,
    sort_order: 0,
  };
}

export function eggToInput(row: EasterEggRow): EasterEggInput {
  return {
    code: row.code,
    name: row.name,
    hint: row.hint ?? "",
    kind: row.kind,
    asset_path: row.asset_path ?? "",
    asset_kind: row.asset_kind,
    transition: row.transition,
    is_enabled: row.is_enabled,
    sort_order: row.sort_order,
  };
}

export function fetchEggs(): Promise<EasterEggRow[]> {
  return api.get<EasterEggRow[]>("/api/admin/easter-eggs");
}

export function createEgg(data: EasterEggInput): Promise<EasterEggRow> {
  return api.post<EasterEggRow>("/api/admin/easter-eggs", {
    ...data,
    hint: data.hint || null,
    asset_path: data.asset_path || null,
  });
}

export function updateEgg(
  id: number,
  data: Partial<EasterEggInput>
): Promise<EasterEggRow> {
  return api.put<EasterEggRow>(`/api/admin/easter-eggs/${id}`, data);
}

export function deleteEgg(id: number): Promise<{ message: string }> {
  return api.delete<{ message: string }>(`/api/admin/easter-eggs/${id}`);
}

/** 上传动态壁纸（mp4 / webm / gif / webp，原样保存不转码） */
export interface WallpaperResult {
  name: string;
  url: string;
  asset_kind: AssetKind;
  size: number;
  warning: string | null;
}

export async function uploadWallpaper(file: File): Promise<WallpaperResult> {
  const form = new FormData();
  form.append("file", file);
  return apiUpload<WallpaperResult>("/api/upload/wallpaper", form);
}

/* 上传要带 FormData，api 封装的 post 会强制 JSON，所以单独走一次 fetch */
async function apiUpload<T>(path: string, form: FormData): Promise<T> {
  const base = (
    process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000"
  ).replace(/\/$/, "");
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    body: form,
    credentials: "include",
  });
  if (!res.ok) {
    let detail = `上传失败 (${res.status})`;
    try {
      const data = await res.json();
      if (data?.detail) detail = data.detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return (await res.json()) as T;
}
