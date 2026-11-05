"use client";

/**
 * 工具的类型与接口封装。
 *
 * 约定与 lib/friendlinks.ts 一致：页面只调这里的函数，不直接拼 URL。
 *
 * kind 表示"点下去会发生什么"：
 *   link 外链   —— 新窗口打开外部网站（href 必须 http/https）
 *   page 站内   —— 跳转到本站已有页面（href 必须 / 开头）
 *   app  下载   —— 下载一个文件（站内 / 路径 或 http(s) 外链）
 */
import { api, withApiBase } from "./api";

export type ToolKind = "link" | "page" | "app";

/** 后台下拉里的类型名 */
export const KIND_LABEL: Record<ToolKind, string> = {
  link: "外链",
  page: "站内页面",
  app: "可下载",
};

/** 类型说明（表单里做提示） */
export const KIND_HINT: Record<ToolKind, string> = {
  link: "新窗口打开外部网站，地址必须以 http:// 或 https:// 开头",
  page: "跳转到本站已有页面（如 /projects），地址以 / 开头",
  app: "下载文件；站内文件写成 /media/tools/xxx.exe，也可以填外链",
};

/** 目标地址输入框的占位示例 */
export const KIND_PLACEHOLDER: Record<ToolKind, string> = {
  link: "https://example.com",
  page: "/projects",
  app: "/media/tools/xxx.exe",
};

export interface Tool {
  id: number;
  slug: string;
  name: string;
  summary: string | null;
  category: string;
  kind: ToolKind;
  icon: string | null;
  href: string;
  tags: string | null;
  sort_order: number;
  is_visible: boolean;
  click_count: number;
  created_at: string;
  updated_at: string;
}

/** 表单里编辑的字段（不含后端生成的 id / click_count / 时间戳） */
export interface ToolInput {
  name: string;
  slug: string;
  summary: string;
  category: string;
  kind: ToolKind;
  icon: string;
  href: string;
  tags: string;
  sort_order: number;
  is_visible: boolean;
}

export const DEFAULT_CATEGORY = "其他";
export const DEFAULT_ICON_NAME = "Wrench";

export function emptyToolInput(): ToolInput {
  return {
    name: "",
    slug: "",
    summary: "",
    category: DEFAULT_CATEGORY,
    kind: "link",
    icon: DEFAULT_ICON_NAME,
    href: "",
    tags: "",
    sort_order: 0,
    is_visible: true,
  };
}

export function toolToInput(tool: Tool): ToolInput {
  return {
    name: tool.name,
    slug: tool.slug,
    summary: tool.summary ?? "",
    category: tool.category,
    kind: tool.kind,
    icon: tool.icon ?? DEFAULT_ICON_NAME,
    href: tool.href,
    tags: tool.tags ?? "",
    sort_order: tool.sort_order,
    is_visible: tool.is_visible,
  };
}

/** "a, b ,c" → ["a","b","c"] */
export function splitTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

/* ---------------- 接口 ---------------- */

/** 前台列表（只含已上架的，已按 sort_order 排序） */
export function fetchTools(): Promise<Tool[]> {
  return api.get<Tool[]>("/api/tools");
}

/** 后台列表（含已下架） */
export function fetchAllTools(): Promise<Tool[]> {
  return api.get<Tool[]>("/api/tools/all");
}

export function fetchTool(id: number): Promise<Tool> {
  return api.get<Tool>(`/api/tools/${id}`);
}

export function createTool(data: Partial<ToolInput>): Promise<Tool> {
  return api.post<Tool>("/api/tools", data);
}

export function updateTool(
  id: number,
  data: Partial<ToolInput>
): Promise<Tool> {
  return api.put<Tool>(`/api/tools/${id}`, data);
}

export function deleteTool(id: number): Promise<{ message: string }> {
  return api.delete<{ message: string }>(`/api/tools/${id}`);
}

/** 批量排序：传整组 (id, sort_order) */
export function reorderTools(
  items: Array<{ id: number; sort_order: number }>
): Promise<{ message: string }> {
  return api.post<{ message: string }>("/api/tools/reorder", items);
}

/**
 * 记一次点击。
 *
 * 点击后往往会立刻跳走，普通 fetch 会被页面卸载打断，
 * 所以优先用 sendBeacon（浏览器会在页面关闭后仍然把请求发出去）。
 */
export function recordToolClick(id: number): void {
  const url = withApiBase(`/api/tools/${id}/click`);
  try {
    if (typeof navigator !== "undefined" && navigator.sendBeacon) {
      const sent = navigator.sendBeacon(
        url,
        new Blob([], { type: "application/json" })
      );
      if (sent) return;
    }
  } catch {
    // 落到下面的 fetch 兜底
  }
  api.post(`/api/tools/${id}/click`, {}).catch(() => {
    // 计数失败不影响跳转
  });
}
