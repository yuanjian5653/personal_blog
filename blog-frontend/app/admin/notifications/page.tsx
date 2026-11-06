"use client";

import { useCallback, useEffect, useState } from "react";

import {
  NOTIFY_EVENT_LABEL,
  NOTIFY_STATUS_LABEL,
  broadcastSiteUpdate,
  deleteNotification,
  fetchNotifications,
  retryNotification,
  type NotificationListResult,
} from "@/lib/notifications";

/**
 * 后台 · 通知队列
 *
 * 发布文章/随笔/动态时会自动写一条待发记录，后台 worker 定期合并发送。
 * 这个页面用来回答两个问题："发出去了吗"、"没发出去是为什么"。
 */
export default function AdminNotificationsPage() {
  const [data, setData] = useState<NotificationListResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 「网站更新」公告的草稿
  const [noticeTitle, setNoticeTitle] = useState("");
  const [noticeSummary, setNoticeSummary] = useState("");
  const [noticePath, setNoticePath] = useState("/");
  const [noticeImmediate, setNoticeImmediate] = useState(true);

  const load = useCallback(() => {
    fetchNotifications()
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "加载失败"));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const sendNotice = async () => {
    const title = noticeTitle.trim();
    if (!title) return;
    if (
      !window.confirm(
        `确定把这个公告发给所有已确认订阅者？\n\n标题：${title}\n` +
          `链接：${noticePath || "/"}`
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const res = await broadcastSiteUpdate({
        title,
        summary: noticeSummary.trim() || undefined,
        path: noticePath.trim() || "/",
        immediate: noticeImmediate,
      });
      flash(res.message);
      setNoticeTitle("");
      setNoticeSummary("");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "发布失败");
    } finally {
      setBusy(false);
    }
  };

  const flash = (msg: string) => {
    setOkMsg(msg);
    window.setTimeout(() => setOkMsg(null), 2000);
  };

  const retry = async (id: number) => {
    setBusy(true);
    try {
      await retryNotification(id);
      flash("已放回队列，下一轮会重发");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "重试失败");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: number, title: string) => {
    if (!window.confirm(`删除这条通知记录？\n\n${title}`)) return;
    setBusy(true);
    try {
      await deleteNotification(id);
      flash("已删除");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除失败");
    } finally {
      setBusy(false);
    }
  };

  const counts = data?.counts ?? {};

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">通知队列</h1>
          {data && (
            <span className="admin-muted text-xs">
              待发送 {counts.pending ?? 0} · 已发送 {counts.sent ?? 0} · 失败{" "}
              {counts.failed ?? 0}
            </span>
          )}
        </div>
        <button
          type="button"
          className="admin-btn admin-btn--ghost"
          onClick={load}
          disabled={busy}
        >
          刷新
        </button>
      </div>

      {data && !data.mail_configured && (
        <p style={{ color: "#f59e0b", fontSize: 13 }}>
          邮件功能未配置（MAIL_FROM / MAIL_PASSWORD 为空）——
          内容发布仍会入队，但发送会一直失败，重试 3 次后标记为「失败」。
        </p>
      )}

      {okMsg && <p className="admin-ok">{okMsg}</p>}
      {error && <p className="admin-error">{error}</p>}

      {/* 手动发「网站更新」公告 */}
      <div className="admin-panel">
        <div className="admin-panel__title">发布网站更新公告</div>
        <p className="admin-muted" style={{ fontSize: 12, marginBottom: 10 }}>
          只在你真的想让订阅者知道时点它。改样式、修错别字这种小改动别发 ——
          发多了订阅者会直接退订。
        </p>

        <div className="admin-filters">
          <label className="admin-field admin-field--grow">
            <span>标题 *</span>
            <input
              value={noticeTitle}
              onChange={(e) => setNoticeTitle(e.target.value)}
              placeholder="例如：导航改版 + 新增邮件订阅"
              maxLength={300}
              disabled={busy}
            />
          </label>

          <label className="admin-field">
            <span>链接</span>
            <input
              value={noticePath}
              onChange={(e) => setNoticePath(e.target.value)}
              placeholder="/ 或 /articles/xxx"
              maxLength={500}
              disabled={busy}
            />
          </label>
        </div>

        <label className="admin-field admin-field--grow">
          <span>一句话说明</span>
          <input
            value={noticeSummary}
            onChange={(e) => setNoticeSummary(e.target.value)}
            placeholder="可选，会显示在标题下面"
            maxLength={500}
            disabled={busy}
          />
        </label>

        <div className="flex items-center gap-4 mt-3">
          <label className="admin-field" style={{ flexDirection: "row" }}>
            <input
              type="checkbox"
              checked={noticeImmediate}
              onChange={(e) => setNoticeImmediate(e.target.checked)}
              disabled={busy}
            />
            <span>立即发送（不排队等冷却）</span>
          </label>

          <button
            type="button"
            className="admin-btn"
            onClick={sendNotice}
            disabled={busy || !noticeTitle.trim()}
          >
            发布公告
          </button>
        </div>
      </div>

      <div className="admin-panel admin-panel--flush">
        {data === null ? (
          <p className="admin-muted p-6">加载中…</p>
        ) : data.items.length === 0 ? (
          <p className="admin-muted p-6">
            还没有通知记录。发布一篇文章（状态为「已发布」）就会自动入队。
          </p>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>内容</th>
                <th>类型</th>
                <th>状态</th>
                <th>计划发送</th>
                <th>已发</th>
                <th style={{ width: 140 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((row) => (
                <tr key={row.id}>
                  <td>
                    <div className="admin-user">
                      <span className="admin-user__name">{row.title}</span>
                      <div className="admin-muted text-xs">{row.url}</div>
                      {row.last_error && (
                        <div style={{ color: "#f87171", fontSize: 11 }}>
                          {row.last_error}
                        </div>
                      )}
                    </div>
                  </td>
                  <td>{NOTIFY_EVENT_LABEL[row.event_type] ?? row.event_type}</td>
                  <td>
                    <span className="admin-badge">
                      {NOTIFY_STATUS_LABEL[row.status] ?? row.status}
                    </span>
                  </td>
                  <td className="admin-muted text-xs">
                    {new Date(row.scheduled_at).toLocaleString("zh-CN")}
                  </td>
                  <td className="tabular-nums">{row.sent_count}</td>
                  <td>
                    <div className="flex items-center gap-3">
                      {row.status !== "sent" && (
                        <button
                          type="button"
                          className="admin-link"
                          disabled={busy}
                          onClick={() => retry(row.id)}
                        >
                          重试
                        </button>
                      )}
                      <button
                        type="button"
                        className="admin-link admin-link--danger"
                        disabled={busy}
                        onClick={() => remove(row.id, row.title)}
                      >
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="admin-muted text-xs">
        提示：同一篇内容只会入队一次（数据库唯一约束）；冷却期内发布的多篇会
        <strong>合并成一封</strong>邮件，避免一天发好几封。
      </p>
    </div>
  );
}
