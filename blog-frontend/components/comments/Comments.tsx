"use client";

import { useEffect, useState } from "react";

import {
  currentPath,
  fetchComments,
  fetchViewer,
  githubLoginUrl,
  logoutCommenter,
  postComment,
  displayName,
  type CommentItemData,
  type CommentTarget,
  type CommenterInfo,
} from "@/lib/comments";
import CommentItem from "./CommentItem";

/** 把评论树按 id 递归更新 */
function mapTree(
  list: CommentItemData[],
  fn: (c: CommentItemData) => CommentItemData | null
): CommentItemData[] {
  const out: CommentItemData[] = [];
  for (const c of list) {
    const next = fn(c);
    if (!next) continue;
    out.push({ ...next, replies: mapTree(next.replies, fn) });
  }
  return out;
}

function removeFromTree(list: CommentItemData[], id: number): CommentItemData[] {
  return mapTree(list, (c) => (c.id === id ? null : c));
}

interface Props {
  /** 评论目标：essay / life / article / guestbook */
  target: CommentTarget;
  /** 目标 id；guestbook 没有 id，可不传 */
  targetId?: number;
  /** 标题文案，默认「评论」 */
  title?: string;
  /** 输入框占位文案 */
  placeholder?: string;
  /** 空列表文案 */
  emptyText?: string;
}

/**
 * 评论区。说说页、生活动态详情、文章底部、杂谈留言板共用 ——
 * 它们只有 target 不同。
 */
export default function Comments({
  target,
  targetId,
  title = "评论",
  placeholder = "说点什么…",
  emptyText = "还没有评论，来抢沙发～",
}: Props) {
  // null = 还没加载完；用它表示"加载中"，避免额外的 loading 状态
  const [comments, setComments] = useState<CommentItemData[] | null>(null);
  const [viewer, setViewer] = useState<CommenterInfo | null>(null);
  const [viewerReady, setViewerReady] = useState(false);

  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<{ id: number; name: string } | null>(null);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetchViewer()
      .then((v) => {
        if (!cancelled) setViewer(v);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setViewerReady(true);
      });

    fetchComments(target, targetId)
      .then((d) => {
        if (!cancelled) setComments(d.comments);
      })
      .catch(() => {
        if (!cancelled) setComments([]);
      });

    return () => {
      cancelled = true;
    };
  }, [target, targetId]);

  const total = comments
    ? comments.reduce((n, c) => n + 1 + c.replies.length, 0)
    : 0;

  const requireLogin = () => {
    setHint("请先用 GitHub 登录后再评论或点赞");
  };

  const handleSubmit = async () => {
    const content = draft.trim();
    if (!content) return;
    if (!viewer) {
      requireLogin();
      return;
    }

    setPosting(true);
    setError(null);
    try {
      const created = await postComment(
        target,
        targetId,
        content,
        replyTo?.id ?? null
      );
      if (created.parent_id) {
        // 回复：挂到对应父评论下
        setComments((prev) =>
          (prev ?? []).map((c) =>
            c.id === created.parent_id
              ? { ...c, replies: [...c.replies, created] }
              : c
          )
        );
      } else if (target === "guestbook") {
        // 留言板是"最新在最上面"，新留言插到最前
        setComments((prev) => [created, ...(prev ?? [])]);
      } else {
        setComments((prev) => [...(prev ?? []), created]);
      }
      setDraft("");
      setReplyTo(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "发表失败");
    } finally {
      setPosting(false);
    }
  };

  // Ctrl/Cmd + Enter 快捷发送
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleDeleted = (id: number) => {
    setComments((prev) => (prev ? removeFromTree(prev, id) : prev));
  };

  const handleLikeChanged = (id: number, likes: number, liked: boolean) => {
    setComments((prev) =>
      prev
        ? mapTree(prev, (c) => (c.id === id ? { ...c, likes, liked } : c))
        : prev
    );
  };

  const handleLogout = async () => {
    try {
      await logoutCommenter();
    } catch {}
    setViewer(null);
  };

  return (
    <div className="comments">
      <div className="comments__head">
        <span className="comments__title">{title}</span>
        {total > 0 && <span className="comments__count">{total}</span>}

        {viewerReady && viewer && (
          <div className="comments__me">
            {viewer.avatar_url && (
              <img src={viewer.avatar_url} alt="" className="comments__me-avatar" />
            )}
            <span className="comments__me-name">
              {displayName({
                author_login: viewer.login,
                author_name: viewer.name,
              })}
            </span>
            <button type="button" className="comments__logout" onClick={handleLogout}>
              退出
            </button>
          </div>
        )}
      </div>

      {/* 未登录：给出 GitHub 登录入口 */}
      {viewerReady && !viewer && (
        <div className="comments__login">
          <a className="comments__github-btn" href={githubLoginUrl(currentPath())}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.55 0-.27-.01-1.17-.02-2.12-3.2.69-3.87-1.36-3.87-1.36-.52-1.33-1.28-1.68-1.28-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.75 2.69 1.25 3.35.95.1-.74.4-1.25.72-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11.1 11.1 0 0 1 2.9-.39c.98 0 1.97.13 2.9.39 2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.8 1.19 1.83 1.19 3.09 0 4.42-2.7 5.39-5.26 5.68.41.35.78 1.05.78 2.12 0 1.53-.01 2.76-.01 3.14 0 .31.21.67.8.55A10.99 10.99 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5z" />
            </svg>
            使用 GitHub 登录后评论
          </a>
          {hint && <p className="comments__hint">{hint}</p>}
        </div>
      )}

      {/* 登录后：评论输入框 */}
      {viewer && (
        <div className="comments__form">
          {replyTo && (
            <div className="comments__replying">
              正在回复 <b>{replyTo.name}</b>
              <button type="button" onClick={() => setReplyTo(null)}>
                取消
              </button>
            </div>
          )}
          <textarea
            className="comments__textarea"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={replyTo ? `回复 ${replyTo.name}…` : placeholder}
            rows={3}
            maxLength={2000}
          />
          {error && <p className="comments__error">{error}</p>}
          <div className="comments__form-foot">
            <span className="comments__tip">Ctrl + Enter 发送 · {draft.length}/2000</span>
            <button
              type="button"
              className="comments__submit"
              onClick={handleSubmit}
              disabled={posting || !draft.trim()}
            >
              {posting ? "发送中…" : "发表"}
            </button>
          </div>
        </div>
      )}

      {/* 列表 */}
      {comments === null ? (
        <div className="comments__empty">加载评论中…</div>
      ) : comments.length === 0 ? (
        <div className="comments__empty">{emptyText}</div>
      ) : (
        <div className="comments__list">
          {comments.map((c) => (
            <CommentItem
              key={c.id}
              comment={c}
              viewer={viewer}
              onRequireLogin={requireLogin}
              onReply={(id, name) => setReplyTo({ id, name })}
              onDeleted={handleDeleted}
              onLikeChanged={handleLikeChanged}
            />
          ))}
        </div>
      )}
    </div>
  );
}
