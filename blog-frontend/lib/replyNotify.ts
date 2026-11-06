"use client";

/**
 * 站内回复通知（红点）的接口封装。
 *
 * 注意：`lib/notifications.ts` 是**后台**的"内容推送队列"（outbox），
 * 和这里的"某人回复了你的评论"完全是两件事，所以文件分开。
 *
 * 未登录时后端返回 401。导航栏的处理策略是"失败就当未登录"——
 * 不区分 401 和其它错误，反正结果一样：不显示红点。
 */
import { api } from "./api";

export interface ReplyNotice {
  id: number;
  comment_id: number;
  parent_comment_id: number | null;
  target_type: string;
  target_id: number | null;
  /** 点开跳到哪（相对路径，如 /articles/xxx） */
  link: string;
  /** 回复内容摘要 */
  preview: string;
  actor_login: string;
  actor_name: string | null;
  actor_avatar: string | null;
  is_read: boolean;
  created_at: string;
}

export interface ReplyNoticeList {
  items: ReplyNotice[];
  unread_count: number;
}

export interface UnreadCount {
  count: number;
}

/** 通知列表 + 未读数 */
export function fetchReplyNotices(): Promise<ReplyNoticeList> {
  return api.get<ReplyNoticeList>("/api/notifications");
}

/** 只取未读数（红点轮询用） */
export function fetchUnreadCount(): Promise<UnreadCount> {
  return api.get<UnreadCount>("/api/notifications/unread-count");
}

/** 标为已读：不传 ids 就是全部 */
export function markNoticesRead(ids?: number[]): Promise<UnreadCount> {
  return api.post<UnreadCount>("/api/notifications/read", {
    ids: ids ?? null,
  });
}

/**
 * 已读后广播一个事件，让导航栏的红点立刻消失。
 *
 * 导航栏在 layout 里，切换路由不会重新挂载，
 * 如果没有这个事件，用户点完"全部已读"还得等下一次轮询（最长 60 秒）红点才消失。
 */
export const NOTICES_READ_EVENT = "reply-notices-read";

export function broadcastNoticesRead(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(NOTICES_READ_EVENT));
}

/** 目标类型的中文名 */
export const TARGET_LABEL: Record<string, string> = {
  article: "文章",
  essay: "随笔",
  life: "生活",
  guestbook: "杂谈",
};
