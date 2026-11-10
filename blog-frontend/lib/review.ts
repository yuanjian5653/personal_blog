import { api } from "./api";

/**
 * 审核队列（阶段 2-B）。
 *
 * 与后端 routers/review.py 一一对应。
 * 待审数量很少（个人站），一次取全量，不做分页。
 *
 * 注意：审核策略没有全局开关了 —— 它现在是每个成员自己的属性
 * （need_review），在「成员管理」里逐个设置。
 */

export type ReviewKind = "article" | "essay" | "life" | "photo" | "friendlink";

export interface PendingItem {
  kind: ReviewKind;
  kind_label: string;
  id: number;
  title: string;
  author_id: number | null;
  author_name: string;
  created_at: string | null;
}

export interface ReviewQueue {
  items: PendingItem[];
  counts: Record<ReviewKind, number>;
  total: number;
}

export const KIND_ORDER: ReviewKind[] = [
  "article",
  "essay",
  "life",
  "photo",
  "friendlink",
];

export const fetchQueue = () => api.get<ReviewQueue>("/api/admin/review");

export const decide = (
  kind: ReviewKind,
  id: number,
  decision: "approve" | "reject",
  reason?: string
) =>
  api.post<{ message: string }>(`/api/admin/review/${kind}/${id}`, {
    decision,
    ...(reason ? { reason } : {}),
  });
