import { api } from "./api";

/**
 * 审核队列（阶段 2-B）。
 *
 * 与后端 routers/review.py 一一对应。
 * 待审数量很少（个人站），一次取全量，不做分页。
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
  review_required: boolean;
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

export const fetchSettings = () =>
  api.get<{ review_required: boolean }>("/api/admin/review/settings");

export const saveSettings = (reviewRequired: boolean) =>
  api.put<{ review_required: boolean }>("/api/admin/review/settings", {
    review_required: reviewRequired,
  });
