"use client";

/**
 * 订阅相关的接口封装。
 *
 * 注意 subscribe() 的返回值是"统一话术"：后端不会告诉你
 * 这个邮箱是否已经订阅过（防止被用来探测别人的订阅状态），
 * 所以前端也只按"已发送"来处理，不要试图区分。
 */
import { api } from "./api";

export interface SubscribeResult {
  ok: boolean;
  message: string;
}

export interface SubscriberRow {
  id: number;
  email: string;
  status: string;
  source: string | null;
  created_at: string;
  confirmed_at: string | null;
  unsubscribed_at: string | null;
}

export interface SubscriberStats {
  total: number;
  confirmed: number;
  pending: number;
  unsubscribed: number;
}

export interface SubscriberListResult {
  stats: SubscriberStats;
  items: SubscriberRow[];
  /** 服务器上邮件功能是否配置好了；没配时后台会显示提示 */
  mail_configured: boolean;
}

export const STATUS_LABEL: Record<string, string> = {
  confirmed: "已确认",
  pending: "待确认",
  unsubscribed: "已退订",
};

/** 提交订阅申请（后端会发确认信） */
export function subscribe(
  email: string,
  source = "subscribe-page"
): Promise<SubscribeResult> {
  return api.post<SubscribeResult>("/api/subscribe", { email, source });
}

/** 后台：订阅者列表 + 统计 */
export function fetchSubscribers(
  status?: string
): Promise<SubscriberListResult> {
  const q = status ? `?status=${encodeURIComponent(status)}` : "";
  return api.get<SubscriberListResult>(`/api/admin/subscribers${q}`);
}

/** 后台：删除订阅者 */
export function deleteSubscriber(id: number): Promise<{ message: string }> {
  return api.delete<{ message: string }>(`/api/admin/subscribers/${id}`);
}

/** 后台：重发确认信 */
export function resendConfirm(id: number): Promise<{ message: string }> {
  return api.post<{ message: string }>(
    `/api/admin/subscribers/${id}/resend`,
    {}
  );
}
