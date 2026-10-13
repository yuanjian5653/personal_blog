"use client";

import { api } from "./api";

/** 一个统计卡片 */
export interface StatCard {
  key: string;
  label: string;
  value: number;
}

export interface TrendPoint {
  date: string;
  value: number;
}

export interface DistributionSlice {
  name: string;
  value: number;
}

export interface DashboardStats {
  cards: StatCard[];
  article_trend: TrendPoint[];
  visitor_trend: TrendPoint[];
  category_distribution: DistributionSlice[];
  browser_distribution: DistributionSlice[];
  range_start: string;
  range_end: string;
}

/** 后台评论管理里的一行（顶层评论，回复在 replies 里） */
export interface AdminReply {
  id: number;
  author_login: string;
  author_name: string | null;
  author_avatar: string | null;
  author_html_url: string | null;
  content: string;
  ip: string | null;
  status: string;
  created_at: string;
}

export interface AdminComment {
  id: number;
  target_type: "essay" | "life" | "article" | "guestbook";
  target_id: number | null;
  target_title: string;
  author_login: string;
  author_name: string | null;
  author_avatar: string | null;
  author_html_url: string | null;
  content: string;
  ip: string | null;
  reply_count: number;
  status: string;
  created_at: string;
  replies: AdminReply[];
}

export interface AdminCommentList {
  total: number;
  page: number;
  page_size: number;
  comments: AdminComment[];
}

export interface CommentQuery {
  target?: string;
  status?: string;
  keyword?: string;
  page?: number;
  page_size?: number;
}

export function fetchDashboardStats(): Promise<DashboardStats> {
  return api.get<DashboardStats>("/api/admin/stats");
}

export function fetchAdminComments(
  q: CommentQuery = {}
): Promise<AdminCommentList> {
  const sp = new URLSearchParams();
  if (q.target) sp.set("target", q.target);
  if (q.status) sp.set("status", q.status);
  if (q.keyword) sp.set("keyword", q.keyword);
  sp.set("page", String(q.page ?? 1));
  sp.set("page_size", String(q.page_size ?? 20));
  return api.get<AdminCommentList>(`/api/admin/comments?${sp}`);
}

export function updateCommentStatus(
  id: number,
  status: "approved" | "rejected"
): Promise<{ message: string; status: string }> {
  return api.put<{ message: string; status: string }>(
    `/api/admin/comments/${id}/status`,
    { status }
  );
}

export function deleteAdminComment(id: number): Promise<{ message: string }> {
  return api.delete<{ message: string }>(`/api/admin/comments/${id}`);
}

/** 目标类型的中文名 */
export const TARGET_LABELS: Record<string, string> = {
  essay: "说说",
  life: "生活动态",
  article: "文章",
  guestbook: "杂谈",
};

export const STATUS_LABELS: Record<string, string> = {
  approved: "已通过",
  rejected: "已拒绝",
};
