"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { MorphIcon } from "morphicons/react";
import { Plus, RefreshCw } from "lucide";

import ReviewStatusBadge from "@/components/admin/ReviewStatusBadge";
import { resolveImageUrl } from "@/lib/url";
import {
  deleteFriendLink,
  fetchAllFriendLinks,
  updateFriendLink,
  type FriendLink,
} from "@/lib/friendlinks";

/**
 * 友链管理（列表只负责看和删，编辑去独立页面）
 *
 * 为什么改成独立编辑页：
 *   以前这条列表上面挂着一整块表单，和文章 / 说说 / 动态 / 图片组的
 *   「进页面编辑」完全不是一种交互。统一之后，所有内容都是
 *   「列表 → 点编辑 → 编辑页 → 返回」，心智负担小得多。
 */
export default function AdminFriendsPage() {
  const [links, setLinks] = useState<FriendLink[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetchAllFriendLinks()
      .then(setLinks)
      .catch((e) => {
        setError(e instanceof Error ? e.message : "加载失败");
        setLinks([]);
      });
  }, []);

  useEffect(() => {
    load();
    // 从编辑页返回时重新拉一次，避免看到旧状态
    const onPageShow = () => load();
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, [load]);

  const flash = (m: string) => {
    setMsg(m);
    window.setTimeout(() => setMsg(null), 3000);
  };

  const toggleVisible = async (link: FriendLink) => {
    setError(null);
    try {
      await updateFriendLink(link.id, { is_visible: !link.is_visible });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    }
  };

  const remove = async (link: FriendLink) => {
    if (!window.confirm(`确定删除友链「${link.name}」？`)) return;
    setBusy(true);
    setError(null);
    try {
      await deleteFriendLink(link.id);
      flash("已删除");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除失败");
    } finally {
      setBusy(false);
    }
  };

  /** 权重区间，用于在表格里画相对长度条 */
  const weightRange = useMemo(() => {
    if (!links || links.length === 0) return { min: 0, max: 1 };
    const ws = links.map((l) => l.weight);
    return { min: Math.min(...ws), max: Math.max(...ws) };
  }, [links]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">友链管理</h1>
          {links && <span className="admin-muted text-xs">共 {links.length} 条</span>}
        </div>
        <div className="admin-actions">
          <button
            type="button"
            className="admin-btn admin-btn--ghost"
            onClick={() => load()}
          >
            <MorphIcon icon={RefreshCw} size={14} /> 刷新
          </button>
          <Link href="/admin/friends/new" className="admin-btn">
            <MorphIcon icon={Plus} size={14} /> 添加友链
          </Link>
        </div>
      </div>

      {error && <p className="admin-error">{error}</p>}
      {msg && <p className="admin-ok">{msg}</p>}

      <div className="admin-panel admin-panel--flush">
        {links === null ? (
          <p className="admin-muted p-6">加载中…</p>
        ) : links.length === 0 ? (
          <p className="admin-muted p-6">
            还没有友链。点右上角「添加友链」。
          </p>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>封面</th>
                <th>名称 / 网址</th>
                <th>类型</th>
                <th>权重</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {links.map((link) => (
                <tr
                  key={link.id}
                  style={link.is_visible ? undefined : { opacity: 0.55 }}
                >
                  <td>
                    {link.cover ? (
                      <img loading="lazy" decoding="async"
                        src={resolveImageUrl(link.cover)}
                        alt=""
                        className="admin-avatar"
                      />
                    ) : (
                      <span className="admin-avatar admin-avatar--fallback">
                        {link.name[0]?.toUpperCase()}
                      </span>
                    )}
                  </td>
                  <td>
                    <div className="admin-user">
                      <span className="admin-user__name">{link.name}</span>
                      <ReviewStatusBadge
                        status={link.review_status}
                        note={link.review_note}
                      />
                    </div>
                    <a
                      className="admin-muted admin-cell-sub fl-url"
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {link.url}
                    </a>
                    {link.description && (
                      <div
                        className="admin-muted admin-cell-sub"
                        title={link.description}
                      >
                        {link.description}
                      </div>
                    )}
                  </td>
                  <td>
                    {link.category ? (
                      <span className="admin-tag">{link.category}</span>
                    ) : (
                      <span className="admin-muted">-</span>
                    )}
                  </td>
                  <td>
                    {/* 权重条：让"相对大小"在表格里也能一眼看出 */}
                    <div className="fl-weight">
                      <span className="fl-weight__num">{link.weight}</span>
                      <span className="fl-weight__bar">
                        <span
                          className="fl-weight__fill"
                          style={{
                            width: `${weightPercent(link.weight, weightRange)}%`,
                          }}
                        />
                      </span>
                    </div>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="admin-link"
                      onClick={() => void toggleVisible(link)}
                      title="点击切换显示 / 隐藏"
                    >
                      {link.is_visible ? "显示中" : "已隐藏"}
                    </button>
                  </td>
                  <td>
                    <div className="admin-actions">
                      <Link className="admin-link" href={`/admin/friends/${link.id}`}>
                        编辑
                      </Link>
                      <button
                        type="button"
                        className="admin-link admin-link--danger"
                        disabled={busy}
                        onClick={() => void remove(link)}
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
    </div>
  );
}

/** 把权重换算成 0..100 的条长（全部同权重时给满格，避免看起来都是空的） */
function weightPercent(
  weight: number,
  range: { min: number; max: number }
): number {
  if (range.max === range.min) return 100;
  const t = (weight - range.min) / (range.max - range.min);
  // 留一点最小可见长度，负权重也能看出有值
  return 8 + t * 92;
}
