"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { formatDateTimeSeconds } from "@/lib/format";

interface LogItem {
  id: number;
  admin_id: number;
  admin_username: string;
  action: string;
  target_type: string;
  target_id: number | null;
  changes: Record<string, { old: unknown; new: unknown }> | null;
  created_at: string;
}

const ACTION_LABEL: Record<string, string> = {
  create: "新建",
  update: "更新",
  delete: "删除",
};

const ACTION_COLOR: Record<string, string> = {
  create: "#4ade80",
  update: "#facc15",
  delete: "#f87171",
};

const TARGET_LABEL: Record<string, string> = {
  song: "歌曲",
  playlist: "歌单",
  post: "内容",
  article: "文章",
  essay: "随笔",
  album: "相册",
  photo: "照片",
  site_config: "站点配置",
};

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "object") return JSON.stringify(v);
  const s = String(v);
  return s.length > 60 ? s.slice(0, 60) + "…" : s;
}

export default function AdminLogsPage() {
  // null = 当前筛选条件下的数据尚未到位；loading 由它派生，避免在 effect 里同步 setState
  const [logs, setLogs] = useState<LogItem[] | null>(null);
  const loading = logs === null;
  const [filterAction, setFilterAction] = useState<string>("");
  const [filterTarget, setFilterTarget] = useState<string>("");
  const [expanded, setExpanded] = useState<number | null>(null);

  // 筛选条件决定请求地址
  const query = useMemo(() => {
    const q = new URLSearchParams();
    if (filterAction) q.set("action", filterAction);
    if (filterTarget) q.set("target_type", filterTarget);
    return q.toString();
  }, [filterAction, filterTarget]);

  useEffect(() => {
    let cancelled = false;
    api
      .get<LogItem[]>(`/api/logs?${query}`)
      .then((list) => {
        if (!cancelled) setLogs(list);
      })
      .catch(() => {
        if (!cancelled) setLogs([]);
      });
    return () => {
      cancelled = true;
    };
  }, [query]);

  // 改筛选条件时先回到"加载中"，这是用户事件，不是 effect
  const changeFilter = (setter: (v: string) => void) => (v: string) => {
    setLogs(null);
    setter(v);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <h1 className="text-2xl font-bold">操作日志</h1>

        <div className="flex items-center gap-3 flex-wrap">
          <select
            value={filterAction}
            onChange={(e) => changeFilter(setFilterAction)(e.target.value)}
            className="admin-input"
          >
            <option value="" style={{ background: "#171a21" }}>
              全部动作
            </option>
            <option value="create" style={{ background: "#171a21" }}>
              新建
            </option>
            <option value="update" style={{ background: "#171a21" }}>
              更新
            </option>
            <option value="delete" style={{ background: "#171a21" }}>
              删除
            </option>
          </select>

          <select
            value={filterTarget}
            onChange={(e) => changeFilter(setFilterTarget)(e.target.value)}
            className="admin-input"
          >
            <option value="" style={{ background: "#171a21" }}>
              全部类型
            </option>
            {Object.entries(TARGET_LABEL).map(([k, v]) => (
              <option key={k} value={k} style={{ background: "#171a21" }}>
                {v}
              </option>
            ))}
          </select>
        </div>
      </div>

      {loading ? (
        <div style={{ color: "var(--text-secondary)" }}>加载中...</div>
      ) : logs.length === 0 ? (
        <div
          className="glass p-16 text-center text-sm"
          style={{ color: "var(--text-secondary)" }}
        >
          没有日志
        </div>
      ) : (
        <div className="glass overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr
                style={{
                  background: "var(--adm-tag-bg)",
                  borderBottom: "1px solid var(--adm-tag-bg)",
                }}
              >
                <th className="text-left px-4 py-3 font-medium" style={{ color: "var(--text-secondary)" }}>时间</th>
                <th className="text-left px-4 py-3 font-medium" style={{ color: "var(--text-secondary)" }}>管理员</th>
                <th className="text-left px-4 py-3 font-medium" style={{ color: "var(--text-secondary)" }}>动作</th>
                <th className="text-left px-4 py-3 font-medium" style={{ color: "var(--text-secondary)" }}>对象</th>
                <th className="text-left px-4 py-3 font-medium" style={{ color: "var(--text-secondary)" }}>变更</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => {
                const isExpanded = expanded === log.id;
                const changesList = log.changes
                  ? Object.entries(log.changes)
                  : [];

                return (
                  <tr
                    key={log.id}
                    onClick={() => setExpanded(isExpanded ? null : log.id)}
                    className="cursor-pointer transition-colors hover:bg-[var(--adm-row-hover)]"
                    style={{
                      borderBottom: "1px solid var(--adm-tag-bg)",
                    }}
                  >
                    <td
                      className="px-4 py-3 text-xs tabular-nums whitespace-nowrap"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      {formatDateTimeSeconds(log.created_at)}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {log.admin_username}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className="text-xs px-2 py-0.5 rounded"
                        style={{
                          background: `${ACTION_COLOR[log.action]}22`,
                          color: ACTION_COLOR[log.action] || "var(--text-secondary)",
                        }}
                      >
                        {ACTION_LABEL[log.action] || log.action}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {TARGET_LABEL[log.target_type] || log.target_type}
                      {log.target_id != null && (
                        <span
                          className="ml-1"
                          style={{ color: "var(--text-secondary)" }}
                        >
                          #{log.target_id}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: "var(--text-secondary)" }}>
                      {changesList.length > 0 ? (
                        <div className="flex flex-col gap-1">
                          {(isExpanded ? changesList : changesList.slice(0, 1)).map(
                            ([field, change]) => (
                              <div key={field} className="flex items-center gap-1.5">
                                <span style={{ color: "var(--adm-blue)" }}>{field}:</span>
                                <span className="truncate" style={{ maxWidth: 200 }}>
                                  {formatValue(change.old)}
                                </span>
                                <span>→</span>
                                <span className="truncate" style={{ maxWidth: 200 }}>
                                  {formatValue(change.new)}
                                </span>
                              </div>
                            )
                          )}
                          {!isExpanded && changesList.length > 1 && (
                            <span style={{ opacity: 0.6 }}>
                              ... 还有 {changesList.length - 1} 项
                            </span>
                          )}
                        </div>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}