"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import {
  TARGET_LABEL,
  broadcastNoticesRead,
  fetchReplyNotices,
  markNoticesRead,
  type ReplyNotice,
} from "@/lib/replyNotify";
import { fetchViewer, githubLoginUrl, type CommenterInfo } from "@/lib/comments";

/**
 * 站内通知页 /notifications
 *
 * 只做一件事：把"谁回复了你的哪条评论"列出来，点进去跳到对应页面。
 * 未登录时给一个 GitHub 登录入口（登录完回到本页）。
 */
type State =
  | { kind: "loading" }
  | { kind: "anon" }
  | { kind: "ready"; items: ReplyNotice[]; unread: number }
  | { kind: "error"; message: string };

function timeAgo(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const diff = Date.now() - t;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour} 小时前`;
  const day = Math.floor(hour / 24);
  if (day < 30) return `${day} 天前`;
  return new Date(iso).toLocaleDateString("zh-CN");
}

export default function NotificationsPage() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [viewer, setViewer] = useState<CommenterInfo | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetchReplyNotices()
      .then((r) => setState({ kind: "ready", items: r.items, unread: r.unread_count }))
      .catch((e) => {
        // 401 时给登录入口，其它错误显示原因
        const msg = e instanceof Error ? e.message : "加载失败";
        if (msg.includes("登录")) {
          fetchViewer().then(setViewer).catch(() => {});
          setState({ kind: "anon" });
        } else {
          setState({ kind: "error", message: msg });
        }
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const markAll = async () => {
    setBusy(true);
    try {
      await markNoticesRead();
      broadcastNoticesRead();
      setState((s) =>
        s.kind === "ready"
          ? { ...s, unread: 0, items: s.items.map((i) => ({ ...i, is_read: true })) }
          : s
      );
    } catch {
      // 标记失败不弹窗：下次进页面还会再试
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="notices-page">
      <header className="notices-head">
        <h1 className="notices-title">通知</h1>
        {state.kind === "ready" && state.unread > 0 && (
          <button
            type="button"
            className="notices-markall"
            onClick={markAll}
            disabled={busy}
          >
            全部标为已读
          </button>
        )}
      </header>

      {state.kind === "loading" && <p className="notices-hint">加载中…</p>}

      {state.kind === "anon" && (
        <div className="notices-empty">
          <p>登录后才能看到「有人回复了你」的通知。</p>
          <a className="notices-login" href={githubLoginUrl("/notifications")}>
            用 GitHub 登录
          </a>
          {viewer && (
            <p className="notices-hint">当前身份：{viewer.login}</p>
          )}
        </div>
      )}

      {state.kind === "error" && (
        <p className="notices-error">{state.message}</p>
      )}

      {state.kind === "ready" &&
        (state.items.length === 0 ? (
          <div className="notices-empty">
            <p>还没有人回复你的评论。</p>
            <p className="notices-hint">
              别人在文章、随笔、生活或杂谈里回复你时，这里会亮起红点。
            </p>
          </div>
        ) : (
          <ul className="notices-list">
            {state.items.map((n) => (
              <li
                key={n.id}
                className={`notices-item${n.is_read ? "" : " is-unread"}`}
              >
                <span className="notices-item__avatar">
                  {n.actor_avatar ? (
                    <img src={n.actor_avatar} alt="" width={32} height={32} />
                  ) : (
                    <span className="notices-item__avatar-fallback">
                      {(n.actor_name || n.actor_login || "?").slice(0, 1)}
                    </span>
                  )}
                </span>

                <div className="notices-item__body">
                  <p className="notices-item__text">
                    <strong>{n.actor_name || n.actor_login}</strong>
                    <span className="notices-item__muted"> 回复了你的评论</span>
                  </p>
                  <p className="notices-item__preview">{n.preview}</p>
                  <p className="notices-item__meta">
                    <Link href={n.link} className="notices-item__link">
                      查看{TARGET_LABEL[n.target_type] ?? "原页面"} →
                    </Link>
                    <span className="notices-item__time">
                      {timeAgo(n.created_at)}
                    </span>
                  </p>
                </div>

                {!n.is_read && (
                  <span className="notices-item__dot" aria-label="未读" />
                )}
              </li>
            ))}
          </ul>
        ))}

      <p className="notices-foot">
        <Link href="/">← 回首页</Link>
      </p>
    </div>
  );
}
