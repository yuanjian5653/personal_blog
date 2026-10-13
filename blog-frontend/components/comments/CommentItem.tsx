"use client";

import { useState } from "react";

import {
  displayName,
  deleteComment,
  toggleCommentLike,
  type CommentItemData,
  type CommenterInfo,
} from "@/lib/comments";
import { formatDateTime, relativeTime } from "@/lib/format";

interface Props {
  comment: CommentItemData;
  viewer: CommenterInfo | null;
  /** 是否是回复（回复不显示"回复"按钮，只支持一级） */
  isReply?: boolean;
  onRequireLogin: () => void;
  onReply: (parentId: number, login: string) => void;
  onDeleted: (id: number) => void;
  onLikeChanged: (id: number, likes: number, liked: boolean) => void;
}

export default function CommentItem({
  comment,
  viewer,
  isReply = false,
  onRequireLogin,
  onReply,
  onDeleted,
  onLikeChanged,
}: Props) {
  const [busy, setBusy] = useState(false);

  const name = displayName(comment);
  const avatar = comment.author_avatar;

  const handleLike = async () => {
    if (!viewer) {
      onRequireLogin();
      return;
    }
    if (busy) return;
    setBusy(true);
    try {
      const res = await toggleCommentLike(comment.id);
      onLikeChanged(comment.id, res.likes, res.liked);
    } catch {
      // 失败就保持原状
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await deleteComment(comment.id);
      onDeleted(comment.id);
    } catch {
      setBusy(false);
    }
  };

  return (
    <div className={`comment-item${isReply ? " is-reply" : ""}`}>
      {/* 头像 */}
      <a
        className="comment-avatar"
        href={comment.author_html_url || "#"}
        target="_blank"
        rel="noopener noreferrer"
        title={name}
      >
        {avatar ? (
          <img src={avatar} alt={name} loading="lazy" />
        ) : (
          <span>{name[0]?.toUpperCase() || "?"}</span>
        )}
      </a>

      <div className="comment-body">
        <div className="comment-head">
          <a
            className="comment-name"
            href={comment.author_html_url || "#"}
            target="_blank"
            rel="noopener noreferrer"
          >
            {name}
          </a>
          <span className="comment-time" title={formatDateTime(comment.created_at)}>
            {relativeTime(comment.created_at)}
          </span>
        </div>

        <p className="comment-content">{comment.content}</p>

        <div className="comment-actions">
          <button
            type="button"
            className={`comment-action${comment.liked ? " is-on" : ""}`}
            onClick={handleLike}
            disabled={busy}
            aria-label={comment.liked ? "取消点赞" : "点赞"}
            title={viewer ? "点赞" : "登录后可点赞"}
          >
            {comment.liked ? "♥" : "♡"} {comment.likes > 0 ? comment.likes : ""}
          </button>

          {!isReply && (
            <button
              type="button"
              className="comment-action"
              onClick={() => onReply(comment.id, name)}
            >
              回复
            </button>
          )}

          {comment.mine && (
            <button
              type="button"
              className="comment-action comment-action--danger"
              onClick={handleDelete}
              disabled={busy}
            >
              删除
            </button>
          )}
        </div>

        {/* 一级回复 */}
        {comment.replies.length > 0 && (
          <div className="comment-replies">
            {comment.replies.map((r) => (
              <CommentItem
                key={r.id}
                comment={r}
                viewer={viewer}
                isReply
                onRequireLogin={onRequireLogin}
                onReply={onReply}
                onDeleted={onDeleted}
                onLikeChanged={onLikeChanged}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
