"use client";

import { useCallback, useEffect, useState } from "react";
import { MorphIcon } from "morphicons/react";
import { RefreshCw } from "lucide";

import {
  KIND_ORDER,
  PendingItem,
  ReviewKind,
  ReviewQueue,
  decide,
  fetchQueue,
} from "@/lib/review";

/**
 * 内容审核队列（仅管理员）。
 *
 * 样式遵循后台既有页面的约定（与 members / friends / easter-eggs 一致）：
 * Tailwind 打骨架 + .admin-* 做局部样式，label 文字包在 <span> 里。
 */
const KIND_LABEL: Record<ReviewKind, string> = {
  article: "文章",
  essay: "说说",
  life: "动态",
  album: "图片组",
  photo: "图片",
  friendlink: "友链",
};

export default function ReviewPage() {
  const [queue, setQueue] = useState<ReviewQueue | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<string>("");
  const [filter, setFilter] = useState<ReviewKind | "all">("all");

  const load = useCallback(() => {
    return fetchQueue()
      .then((q) => setQueue(q))
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : "加载失败")
      );
  }, []);

  // 首次加载：异步回调里 setState（effect 体内不能同步 setState）
  useEffect(() => {
    let alive = true;
    fetchQueue()
      .then((q) => {
        if (alive) setQueue(q);
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : "加载失败");
      });
    return () => {
      alive = false;
    };
  }, []);

  const flash = (msg: string) => {
    setNotice(msg);
    window.setTimeout(() => setNotice(""), 4000);
  };

  const handleDecide = async (
    item: PendingItem,
    decision: "approve" | "reject"
  ) => {
    let reason: string | undefined;
    if (decision === "reject") {
      const input = window.prompt(
        `驳回「${item.title}」的理由（会记进操作日志，可留空）：`
      );
      if (input === null) return; // 取消
      reason = input.trim() || undefined;
    }

    const key = `${item.kind}-${item.id}`;
    setBusy(key);
    setError("");
    try {
      await decide(item.kind, item.id, decision, reason);
      flash(decision === "approve" ? "已通过" : "已驳回");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusy("");
    }
  };

  const items = queue
    ? filter === "all"
      ? queue.items
      : queue.items.filter((i) => i.kind === filter)
    : [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold">内容审核</h1>
        <div className="admin-actions">
          <span className="admin-muted text-xs">
            {queue ? `待审 ${queue.total} 条` : ""}
          </span>
          <button
            type="button"
            className="admin-btn admin-btn--ghost"
            onClick={() => {
              setError("");
              void load();
            }}
          >
            <MorphIcon icon={RefreshCw} size={14} /> 刷新
          </button>
        </div>
      </div>

      {error && <p className="admin-error">{error}</p>}
      {notice && <p className="admin-ok">{notice}</p>}

      {/* 类型筛选 */}
      <div className="admin-actions" style={{ flexWrap: "wrap" }}>
        <button
          type="button"
          className={
            filter === "all" ? "admin-btn" : "admin-btn admin-btn--ghost"
          }
          onClick={() => setFilter("all")}
        >
          全部（{queue?.total ?? 0}）
        </button>
        {KIND_ORDER.map((k) => (
          <button
            key={k}
            type="button"
            className={
              filter === k ? "admin-btn" : "admin-btn admin-btn--ghost"
            }
            onClick={() => setFilter(k)}
          >
            {KIND_LABEL[k]}（{queue?.counts?.[k] ?? 0}）
          </button>
        ))}
      </div>

      {/* 列表 */}
      <div className="admin-panel admin-panel--flush">
        {queue === null ? (
          <p className="admin-muted p-6">加载中…</p>
        ) : items.length === 0 ? (
          <p className="admin-muted p-6">
            没有待审内容。成员发布后如果开了审核，内容会出现在这里。
          </p>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>类型</th>
                <th>内容</th>
                <th>作者</th>
                <th>提交时间</th>
                <th style={{ width: 160 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const key = `${item.kind}-${item.id}`;
                const working = busy === key;
                return (
                  <tr key={key}>
                    <td>
                      <span className="admin-badge admin-badge--muted">
                        {item.kind_label}
                      </span>
                    </td>
                    <td>
                      <div className="admin-user">
                        <span className="admin-user__name">{item.title}</span>
                        <span className="admin-muted text-xs">
                          #{item.id}
                        </span>
                      </div>
                    </td>
                    <td>{item.author_name}</td>
                    <td className="admin-cell-time">
                      {item.created_at
                        ? new Date(item.created_at).toLocaleString("zh-CN")
                        : "—"}
                    </td>
                    <td>
                      <div className="admin-actions">
                        <button
                          type="button"
                          className="admin-link"
                          disabled={working}
                          onClick={() => void handleDecide(item, "approve")}
                        >
                          {working ? "处理中…" : "通过"}
                        </button>
                        <button
                          type="button"
                          className="admin-link admin-link--danger"
                          disabled={working}
                          onClick={() => void handleDecide(item, "reject")}
                        >
                          驳回
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <p className="admin-muted text-xs">
        通过后内容立即对访客可见；驳回后仍保留在作者那里，ta 可以修改后重新提交。
      </p>
    </div>
  );
}
