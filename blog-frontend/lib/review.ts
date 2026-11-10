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

export type ReviewKind =
  | "article"
  | "essay"
  | "life"
  | "album"
  | "photo"
  | "friendlink";

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
  "album",
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


/**
 * 保存后的提示文案。
 *
 * 成员编辑"已通过"或"已驳回"的内容时，后端会把它重新压回待审
 * （status 也一起变成 draft）。这时候**必须**明确告诉用户
 * "内容暂时下线了"，否则 ta 会以为保存完还是线上状态。
 *
 * 判断依据是保存接口返回的 review_status —— 不额外加字段，
 * 因为响应里本来就有。
 */
export function saveMessage(reviewStatus?: string | null): string {
  return reviewStatus === "pending"
    ? "已保存，并重新提交审核 —— 通过后才会重新公开"
    : "已保存";
}
