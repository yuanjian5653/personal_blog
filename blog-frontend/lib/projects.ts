"use client";

import { api } from "./api";

/** 一个展示中的 GitHub 项目 */
export interface Project {
  id: number;
  full_name: string;
  name: string;
  /** 展示用标题：后台填了 custom_title 就用它 */
  title: string;
  /** 展示用简介：后台填了 custom_description 就用它 */
  summary: string | null;
  /** GitHub 原始描述（未做覆盖时与 summary 相同） */
  description: string | null;
  html_url: string;
  homepage: string | null;
  language: string | null;
  stars: number;
  forks: number;
  topics: string[];
  license: string | null;
  pushed_at: string | null;
  is_visible: boolean;
  is_pinned: boolean;
  sort_order: number;
}

export interface ProjectSyncResult {
  total: number;
  created: number;
  updated: number;
  username: string;
}

export interface ProjectConfig {
  username: string;
  has_token: boolean;
  languages: string;
}

/** 前台列表（只含展示中的，已排好序） */
export function fetchProjects(): Promise<Project[]> {
  return api.get<Project[]>("/api/projects");
}

/** 后台列表（含隐藏） */
export function fetchAllProjects(): Promise<Project[]> {
  return api.get<Project[]>("/api/projects/all");
}

export function fetchProjectConfig(): Promise<ProjectConfig> {
  return api.get<ProjectConfig>("/api/projects/config");
}

export function syncProjects(): Promise<ProjectSyncResult> {
  return api.post<ProjectSyncResult>("/api/projects/sync", {});
}

export function updateProject(
  id: number,
  data: Partial<{
    is_visible: boolean;
    is_pinned: boolean;
    sort_order: number;
    custom_title: string | null;
    custom_description: string | null;
  }>
): Promise<Project> {
  return api.put<Project>(`/api/projects/${id}`, data);
}

export function deleteProject(id: number): Promise<{ message: string }> {
  return api.delete<{ message: string }>(`/api/projects/${id}`);
}

/**
 * 语言 → 颜色。
 *
 * 用 GitHub 官方那套语言配色里的常见几种，其余给一个中性灰。
 * 颜色只用来做小圆点，不参与布局，所以写死没关系。
 */
const LANGUAGE_COLORS: Record<string, string> = {
  typescript: "#3178c6",
  javascript: "#f1e05a",
  python: "#3572A5",
  java: "#b07219",
  go: "#00ADD8",
  rust: "#dea584",
  c: "#555555",
  "c++": "#f34b7d",
  "c#": "#178600",
  php: "#4F5D95",
  ruby: "#701516",
  swift: "#F05138",
  kotlin: "#A97BFF",
  html: "#e34c26",
  css: "#563d7c",
  scss: "#c6538c",
  vue: "#41b883",
  svelte: "#ff3e00",
  shell: "#89e051",
  dockerfile: "#384d54",
  jupyter: "#DA5B0B",
  "jupyter notebook": "#DA5B0B",
};

export function languageColor(lang: string | null): string {
  if (!lang) return "#8b949e";
  return LANGUAGE_COLORS[lang.toLowerCase()] || "#8b949e";
}

/** 相对时间：刚刚 / N 分钟前 / N 天前 / N 个月前 */
export function relativeFrom(dateStr: string | null): string {
  if (!dateStr) return "";
  const t = new Date(dateStr).getTime();
  if (Number.isNaN(t)) return "";
  const diff = Date.now() - t;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour} 小时前`;
  const day = Math.floor(hour / 24);
  if (day < 30) return `${day} 天前`;
  const month = Math.floor(day / 30);
  if (month < 12) return `${month} 个月前`;
  return `${Math.floor(month / 12)} 年前`;
}
