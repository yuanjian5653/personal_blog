"use client";

import { useCallback, useEffect, useState } from "react";

import {
  STATUS_LABEL,
  deleteSubscriber,
  fetchSubscribers,
  resendConfirm,
  type SubscriberListResult,
} from "@/lib/subscribe";

/**
 * 后台 · 订阅管理
 *
 * 只做四件事：看统计、按状态筛选、重发确认信、删除。
 * 没有"导出 CSV"—— 后端也没做，先把闭环跑通再说。
 */
const FILTERS: Array<{ key: string; label: string }> = [
  { key: "", label: "全部" },
  { key: "confirmed", label: "已确认" },
  { key: "pending", label: "待确认" },
  { key: "unsubscribed", label: "已退订" },
];

export default function AdminSubscribersPage() {
  const [data, setData] = useState<SubscriberListResult | null>(null);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetchSubscribers(filter || undefined)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "加载失败"));
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  const flash = (msg: string) => {
    setOkMsg(msg);
    window.setTimeout(() => setOkMsg(null), 2000);
  };

  const remove = async (id: number, email: string) => {
    if (!window.confirm(`确定删除订阅者「${email}」？此操作不可撤销。`)) return;
    setBusy(true);
    try {
      await deleteSubscriber(id);
      flash("已删除");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除失败");
    } finally {
      setBusy(false);
    }
  };

  const resend = async (id: number) => {
    setBusy(true);
    try {
      await resendConfirm(id);
      flash("已重发确认信");
    } catch (e) {
      setError(e instanceof Error ? e.message : "重发失败");
    } finally {
      setBusy(false);
    }
  };

  const stats = data?.stats;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">订阅管理</h1>
          {stats && (
            <span className="admin-muted text-xs">共 {stats.total} 人</span>
          )}
        </div>
      </div>

      {data && !data.mail_configured && (
        <p className="admin-warn" style={{ color: "#f59e0b", fontSize: 13 }}>
          邮件功能未配置（MAIL_FROM / MAIL_PASSWORD 为空）——
          订阅接口会正常记录邮箱，但不会真的发出确认信。
        </p>
      )}

      {okMsg && <p className="admin-ok">{okMsg}</p>}
      {error && <p className="admin-error">{error}</p>}

      {stats && (
        <div className="admin-panel">
          <div className="admin-panel__title">概览</div>
          <div className="admin-filters">
            <div className="admin-field">
              <span>已确认</span>
              <strong style={{ fontSize: 20, color: "var(--accent)" }}>
                {stats.confirmed}
              </strong>
            </div>
            <div className="admin-field">
              <span>待确认</span>
              <strong style={{ fontSize: 20 }}>{stats.pending}</strong>
            </div>
            <div className="admin-field">
              <span>已退订</span>
              <strong style={{ fontSize: 20 }}>{stats.unsubscribed}</strong>
            </div>
            <div className="admin-field">
              <span>总计</span>
              <strong style={{ fontSize: 20 }}>{stats.total}</strong>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            className={`admin-btn${filter === f.key ? "" : " admin-btn--ghost"}`}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="admin-panel admin-panel--flush">
        {data === null ? (
          <p className="admin-muted p-6">加载中…</p>
        ) : data.items.length === 0 ? (
          <p className="admin-muted p-6">
            还没有订阅者。前台的「邮件订阅」入口在页脚。
          </p>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>邮箱</th>
                <th>状态</th>
                <th>来源</th>
                <th>订阅时间</th>
                <th style={{ width: 150 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((row) => (
                <tr key={row.id}>
                  <td>{row.email}</td>
                  <td>
                    <span className="admin-badge">
                      {STATUS_LABEL[row.status] ?? row.status}
                    </span>
                  </td>
                  <td className="admin-muted">{row.source || "—"}</td>
                  <td className="admin-muted">
                    {new Date(row.created_at).toLocaleString("zh-CN")}
                  </td>
                  <td>
                    <div className="flex items-center gap-3">
                      {row.status !== "confirmed" && (
                        <button
                          type="button"
                          className="admin-link"
                          disabled={busy}
                          onClick={() => resend(row.id)}
                        >
                          重发
                        </button>
                      )}
                      <button
                        type="button"
                        className="admin-link admin-link--danger"
                        disabled={busy}
                        onClick={() => remove(row.id, row.email)}
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
        提示：确认与退订链接由后端生成（<code>/api/subscribe/confirm</code>、
        <code>/api/subscribe/unsubscribe</code>），收件人点开即是结果页，不需要登录。
      </p>
    </div>
  );
}
