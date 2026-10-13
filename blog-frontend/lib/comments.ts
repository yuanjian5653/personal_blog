"use client";

import { API_BASE, api } from "./api";

/**
 * 评论目标：
 * - essay     ：说说
 * - life      ：生活动态
 * - article   ：文章
 * - guestbook ：杂谈 / 留言板（没有内容实体，本身就是评论）
 */
export type CommentTarget = "essay" | "life" | "article" | "guestbook";

/** 登录的访客（GitHub 用户） */
export interface CommenterInfo {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string | null;
  html_url: string | null;
}

/** 单条评论 */
export interface CommentItemData {
  id: number;
  essay_id: number | null;
  life_post_id: number | null;
  article_id: number | null;
  target_type: CommentTarget;
  parent_id: number | null;
  content: string;
  author_login: string;
  author_name: string | null;
  author_avatar: string | null;
  author_html_url: string | null;
  likes: number;
  /** 当前登录用户是否已点赞 */
  liked: boolean;
  /** 是否本人发的 */
  mine: boolean;
  created_at: string;
  replies: CommentItemData[];
}

export interface CommentListResponse {
  total: number;
  comments: CommentItemData[];
  viewer: CommenterInfo | null;
}

export interface LikeResponse {
  likes: number;
  liked: boolean;
}

/**
 * GitHub 登录入口：整页跳转到后端，由后端 302 到 GitHub。
 * returnTo 传当前站内路径，登录完成后会跳回这里（否则一律回首页）。
 */
export function githubLoginUrl(returnTo?: string): string {
  const base = `${API_BASE}/api/comments/github/login`;
  if (!returnTo) return base;
  return `${base}?return_to=${encodeURIComponent(returnTo)}`;
}

/** 当前页面的站内路径（含查询参数），用作登录后的返回地址 */
export function currentPath(): string {
  if (typeof window === "undefined") return "/";
  return window.location.pathname + window.location.search;
}

/** 当前登录态（未登录返回 null，不报错） */
export function fetchViewer(): Promise<CommenterInfo | null> {
  return api.get<CommenterInfo | null>("/api/comments/me");
}

/**
 * 评论接口的路径。
 * guestbook 没有 id（只有一个留言板），所以路径里不带数字。
 */
function targetBase(target: CommentTarget, targetId?: number): string {
  if (target === "guestbook") return "/api/comments/guestbook";
  return `/api/comments/${target}/${targetId}`;
}

export function fetchComments(
  target: CommentTarget,
  targetId?: number
): Promise<CommentListResponse> {
  return api.get<CommentListResponse>(targetBase(target, targetId));
}

export function postComment(
  target: CommentTarget,
  targetId: number | undefined,
  content: string,
  parentId?: number | null
): Promise<CommentItemData> {
  return api.post<CommentItemData>(targetBase(target, targetId), {
    content,
    parent_id: parentId ?? null,
  });
}

export function deleteComment(commentId: number): Promise<{ message: string }> {
  return api.delete<{ message: string }>(`/api/comments/${commentId}`);
}

export function toggleCommentLike(commentId: number): Promise<LikeResponse> {
  return api.post<LikeResponse>(`/api/comments/${commentId}/like`);
}

/** 说说点赞（目前只有说说支持目标点赞） */
export function fetchEssayLikes(essayId: number): Promise<LikeResponse> {
  return api.get<LikeResponse>(`/api/comments/essay/${essayId}/like`);
}

export function toggleEssayLike(essayId: number): Promise<LikeResponse> {
  return api.post<LikeResponse>(`/api/comments/essay/${essayId}/like`);
}

export function logoutCommenter(): Promise<{ message: string }> {
  return api.post<{ message: string }>("/api/comments/logout");
}

/** 取展示用昵称：优先 GitHub 昵称，其次用户名 */
export function displayName(c: {
  author_login: string;
  author_name?: string | null;
}): string {
  return c.author_name || c.author_login;
}
