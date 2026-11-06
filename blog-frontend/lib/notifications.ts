"use client";

/**
 * 通知队列的后台接口封装。
 *
 * "通知"指的是"某篇内容要发给订阅者"这条待办记录（outbox），
 * 不是站内消息 —— 站内回复红点还没有实现。
 */
import { api } from "./api";

export interface NotificationRow {
  id: number;
  event_type: string;
  target_type: string;
  target_id: number;
  title: string;
  summary: string | null;
  url: string;
  status: string;
  scheduled_at: string;
  attempts: number;
  last_error: string | null;
  sent_count: number;
  sent_at: string | null;
  created_at: string;
}

export interface NotificationListResult {
  counts: Record<string, number>;
  items: NotificationRow[];
  mail_configured: boolean;
}

export const NOTIFY_STATUS_LABEL: Record<string, string> = {
  pending: "待发送",
  sending: "发送中",
  sent: "已发送",
  failed: "失败",
};

export const NOTIFY_EVENT_LABEL: Record<string, string> = {
  "article.new": "新文章",
  "essay.new": "新随笔",
  "life.new": "新动态",
};

export function fetchNotifications(): Promise<NotificationListResult> {
  return api.get<NotificationListResult>("/api/admin/notifications");
}

export function retryNotification(id: number): Promise<{ message: string }> {
  return api.post<{ message: string }>(
    `/api/admin/notifications/${id}/retry`,
    {}
  );
}

export function deleteNotification(id: number): Promise<{ message: string }> {
  return api.delete<{ message: string }>(`/api/admin/notifications/${id}`);
}
