"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  deleteAdminComment,
  fetchAdminComments,
  STATUS_LABELS,
  TARGET_LABELS,
  updateCommentStatus,
  type AdminComment,
  type AdminCommentList,
} from "@/lib/admin";
import { formatDateTime } from "@/lib/format";
import { useMounted } from "@/lib/useMounted";

/** 目标筛选的下拉项 */
const TARGET_OPTIONS = [
  { value: "", label: "全部" },
  { value: "article", label: "文章" },
  { value: "essay", label: "说说" },
  { value: "life", label: "生活动态" },
  { value: "guestbook", label: "杂谈" },
];

const STATUS_OPTIONS = [
  { value: "", label: "全部状态" },
  { value: "approved", label: "已通过" },
  { value: "rejected", label: "已拒绝" },
];

const PAGE_SIZE = 20;

interface Props {
  /** 固定目标（杂谈管理页会传 guestbook）；不传则显示目标筛选项 */
  fixedTarget?: string;
  /** 标题 */
  title?: string;
}

export default function CommentManager({ fixedTarget, title = "评论管理" }: Props) {
  const mounted = useMounted();

  const [target, setTarget] = useState(fixedTarget ?? "");
  const [status, setStatus] = useState("");
  const [keyword, setKeyword] = useState("");
  // 输入框里的关键词与真正用于查询的分开，避免每敲一个字就请求一次
  const [appliedKeyword, setAppliedKeyword] = useState("");
  const [page, setPage] = useState(1);

  const [data, setData] = useState<AdminCommentList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  // 展开查看回复的行
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const load = useCallback(() => {
    fetchAdminComments({
      target: fixedTarget ?? (target || undefined),
      status: status || undefined,
      keyword: appliedKeyword || undefined,
      page,
      page_size: PAGE_SIZE,
    })
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "加载失败"))
      .finally(() => setLoading(false));
  }, [fixedTarget, target, status, appliedKeyword, page]);

  useEffect(() => {
    if (!mounted) return;
    // 这里先开 loading 再发请求 —— 属于"筛选条件变了就重新拉数据"的正常流程，
    // 不会循环触发（依赖里没有 data/loading）。故定点豁免该规则。
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 见上：筛选变化触发的重新加载
    setLoading(true);
    load();
  }, [mounted, load]);

  const totalPages = useMemo(
    () => (data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1),
    [data]
  );

  const toggleExpand = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleStatus = async (id: number, next: "approved" | "rejected") => {
    setBusyId(id);
    try {
      await updateCommentStatus(id, next);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm("删除这条评论？它下面的回复也会一起删掉。")) return;
    setBusyId(id);
    try {
      await deleteAdminComment(id);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除失败");
    } finally {
      setBusyId(null);
    }
  };

  /** 重置到第一页再筛选 */
  const applyFilter = (fn: () => void) => {
    fn();
    setPage(1);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold">{title}</h1>
        {data && <span className="admin-muted text-xs">共 {data.total} 条</span>}
      </div>

      {/* 筛选栏 */}
      <div className="admin-panel admin-filters">
        {!fixedTarget && (
          <label className="admin-field">
            <span>位置</span>
            <select
              value={target}
              onChange={(e) => applyFilter(() => setTarget(e.target.value))}
            >
              {TARGET_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="admin-field">
          <span>状态</span>
          <select
            value={status}
            onChange={(e) => applyFilter(() => setStatus(e.target.value))}
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <form
          className="admin-field admin-field--grow"
          onSubmit={(e) => {
            e.preventDefault();
            applyFilter(() => setAppliedKeyword(keyword.trim()));
          }}
        >
          <span>搜索</span>
          <input
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="按内容或用户名搜索"
          />
        </form>

        <button
          type="button"
          className="admin-btn"
          onClick={() => applyFilter(() => setAppliedKeyword(keyword.trim()))}
        >
          搜索
        </button>
        {(appliedKeyword || status || target) && (
          <button
            type="button"
            className="admin-btn admin-btn--ghost"
            onClick={() =>
              applyFilter(() => {
                setKeyword("");
                setAppliedKeyword("");
                setStatus("");
                if (!fixedTarget) setTarget("");
              })
            }
          >
            重置
          </button>
        )}
      </div>

      {error && <p className="admin-error">{error}</p>}

      {/* 表格 */}
      <div className="admin-panel admin-panel--flush">
        {loading && !data ? (
          <p className="admin-muted p-6">加载中…</p>
        ) : !data || data.comments.length === 0 ? (
          <p className="admin-muted p-6">没有符合条件的评论</p>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th style={{ width: 60 }}>ID</th>
                <th style={{ width: 170 }}>用户</th>
                <th>内容</th>
                <th style={{ width: 150 }}>位置</th>
                <th style={{ width: 130 }}>IP</th>
                <th style={{ width: 90 }}>回复</th>
                <th style={{ width: 90 }}>状态</th>
                <th style={{ width: 160 }}>时间</th>
                <th style={{ width: 120 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {data.comments.map((c) => (
                <CommentRow
                  key={c.id}
                  comment={c}
                  expanded={expanded.has(c.id)}
                  busy={busyId === c.id}
                  onToggle={() => toggleExpand(c.id)}
                  onStatus={handleStatus}
                  onDelete={handleDelete}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* 分页 */}
      {data && totalPages > 1 && (
        <div className="admin-pager">
          <button
            type="button"
            className="admin-btn"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            上一页
          </button>
          <span className="admin-muted text-xs">
            {page} / {totalPages}
          </span>
          <button
            type="button"
            className="admin-btn"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            下一页
          </button>
        </div>
      )}
    </div>
  );
}

function Avatar({ url, name }: { url: string | null; name: string }) {
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" className="admin-avatar" />;
  }
  return <span className="admin-avatar admin-avatar--fallback">{name[0]?.toUpperCase()}</span>;
}

function CommentRow({
  comment,
  expanded,
  busy,
  onToggle,
  onStatus,
  onDelete,
}: {
  comment: AdminComment;
  expanded: boolean;
  busy: boolean;
  onToggle: () => void;
  onStatus: (id: number, s: "approved" | "rejected") => void;
  onDelete: (id: number) => void;
}) {
  const name = comment.author_name || comment.author_login;
  const rejected = comment.status === "rejected";

  return (
    <>
      <tr className={rejected ? "is-rejected" : ""}>
        <td className="admin-muted">{comment.id}</td>
        <td>
          <div className="admin-user">
            <Avatar url={comment.author_avatar} name={name} />
            <a
              href={comment.author_html_url || "#"}
              target="_blank"
              rel="noopener noreferrer"
              className="admin-user__name"
              title={comment.author_login}
            >
              {name}
            </a>
          </div>
        </td>
        <td className="admin-cell-content" title={comment.content}>
          {comment.content}
        </td>
        <td>
          <span className="admin-tag" title={comment.target_title}>
            {TARGET_LABELS[comment.target_type] ?? comment.target_type}
            {comment.target_id ? ` #${comment.target_id}` : ""}
          </span>
          <div className="admin-muted admin-cell-sub" title={comment.target_title}>
            {comment.target_title}
          </div>
        </td>
        <td className="admin-muted">{comment.ip || "-"}</td>
        <td>
          {comment.reply_count > 0 ? (
            <button type="button" className="admin-link" onClick={onToggle}>
              {expanded ? "收起" : `${comment.reply_count} 条回复`}
            </button>
          ) : (
            <span className="admin-muted">-</span>
          )}
        </td>
        <td>
          <span className={`admin-badge admin-badge--${comment.status}`}>
            {STATUS_LABELS[comment.status] ?? comment.status}
          </span>
        </td>
        <td className="admin-muted admin-cell-time">
          {formatDateTime(comment.created_at)}
        </td>
        <td>
          <div className="admin-actions">
            {rejected ? (
              <button
                type="button"
                className="admin-link"
                disabled={busy}
                onClick={() => onStatus(comment.id, "approved")}
              >
                通过
              </button>
            ) : (
              <button
                type="button"
                className="admin-link admin-link--warn"
                disabled={busy}
                onClick={() => onStatus(comment.id, "rejected")}
              >
                拒绝
              </button>
            )}
            <button
              type="button"
              className="admin-link admin-link--danger"
              disabled={busy}
              onClick={() => onDelete(comment.id)}
            >
              删除
            </button>
          </div>
        </td>
      </tr>

      {/* 展开的回复区：占满整行 */}
      {expanded && comment.replies.length > 0 && (
        <tr className="admin-replies-row">
          <td colSpan={9}>
            <div className="admin-replies">
              <div className="admin-replies__title">
                回复（{comment.replies.length}）
              </div>
              {comment.replies.map((r) => {
                const rName = r.author_name || r.author_login;
                return (
                  <div key={r.id} className="admin-reply">
                    <Avatar url={r.author_avatar} name={rName} />
                    <div className="admin-reply__body">
                      <div className="admin-reply__head">
                        <a
                          href={r.author_html_url || "#"}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="admin-user__name"
                        >
                          {rName}
                        </a>
                        <span className={`admin-badge admin-badge--${r.status}`}>
                          {STATUS_LABELS[r.status] ?? r.status}
                        </span>
                        <span className="admin-muted admin-cell-time">
                          {formatDateTime(r.created_at)}
                        </span>
                        <span className="admin-muted">{r.ip || "-"}</span>
                      </div>
                      <div className="admin-reply__content">{r.content}</div>
                    </div>
                    <div className="admin-actions">
                      {r.status === "rejected" ? (
                        <button
                          type="button"
                          className="admin-link"
                          disabled={busy}
                          onClick={() => onStatus(r.id, "approved")}
                        >
                          通过
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="admin-link admin-link--warn"
                          disabled={busy}
                          onClick={() => onStatus(r.id, "rejected")}
                        >
                          拒绝
                        </button>
                      )}
                      <button
                        type="button"
                        className="admin-link admin-link--danger"
                        disabled={busy}
                        onClick={() => onDelete(r.id)}
                      >
                        删除
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
