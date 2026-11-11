"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { MorphIcon } from "morphicons/react";
import { Plus, RefreshCw } from "lucide";

import AuthorTag from "@/components/admin/AuthorTag";
import ReviewStatusBadge from "@/components/admin/ReviewStatusBadge";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { resolveImageUrl } from "@/lib/url";
import type { LifePost } from "@/lib/types";
import { withMine } from "@/lib/useRole";

/**
 * 生活动态（列表只负责看和删，编辑去独立页面）
 *
 * 原来是弹窗编辑。为了和其他内容统一（文章 / 说说 / 图片组都是独立编辑页），
 * 这里只管列表：新建 → /admin/life/new，编辑 → /admin/life/{id}。
 */
export default function AdminLifePage() {
  // null = 尚未加载完；loading 由它派生，避免在 effect 里同步 setState
  const [posts, setPosts] = useState<LifePost[] | null>(null);
  const loading = posts === null;
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    api
      .get<LifePost[]>(withMine("/api/life"))
      .then(setPosts)
      .catch(() => setPosts([]));
  };

  useEffect(() => {
    load();
    // 从编辑页返回时重新拉一次，避免看到旧状态
    const onPageShow = () => load();
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  const handleDelete = async (p: LifePost) => {
    const preview = p.content.slice(0, 20) || "(无内容)";
    if (!window.confirm(`确定删除这条动态？\n\n${preview}...`)) return;
    setError(null);
    try {
      await api.delete(`/api/life/${p.id}`);
      setPosts((prev) => (prev ?? []).filter((x) => x.id !== p.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除失败");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">生活动态</h1>
          {posts && (
            <span className="admin-muted text-xs">共 {posts.length} 条</span>
          )}
        </div>
        <div className="admin-actions">
          <button
            type="button"
            className="admin-btn admin-btn--ghost"
            onClick={() => load()}
          >
            <MorphIcon icon={RefreshCw} size={14} /> 刷新
          </button>
          <Link href="/admin/life/new" className="admin-btn">
            <MorphIcon icon={Plus} size={14} /> 新建动态
          </Link>
        </div>
      </div>

      {error && <p className="admin-error">{error}</p>}

      {loading ? (
        <p className="admin-muted p-6">加载中…</p>
      ) : posts.length === 0 ? (
        <div className="glass p-16 text-center text-sm" style={{ color: "var(--text-secondary)" }}>
          还没有动态。点右上角「新建动态」。
        </div>
      ) : (
        <div className="space-y-3">
          {posts.map((p) => (
            <div key={p.id} className="glass p-4 group">
              <div className="mb-2 flex items-start justify-between gap-3">
                <div
                  className="flex flex-wrap items-center gap-2 text-xs"
                  style={{ color: "var(--text-secondary)" }}
                >
                  <span>{formatDateTime(p.created_at)}</span>
                  <ReviewStatusBadge
                    status={p.review_status}
                    note={p.review_note}
                  />
                  <AuthorTag authorId={p.author_id} />
                  {p.location && <span>· {p.location}</span>}
                  <span className="admin-like-count" title="点赞数">
                    ♥ {p.likes ?? 0}
                  </span>
                </div>
                <div className="admin-actions">
                  <Link className="admin-link" href={`/admin/life/${p.id}`}>
                    编辑
                  </Link>
                  <button
                    type="button"
                    className="admin-link admin-link--danger"
                    onClick={() => void handleDelete(p)}
                  >
                    删除
                  </button>
                </div>
              </div>

              {p.content && (
                <p
                  className="mb-2 text-sm line-clamp-3"
                  style={{ color: "var(--text-primary)" }}
                >
                  {p.content}
                </p>
              )}

              {p.images.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {p.images.slice(0, 6).map((img, i) => (
                    <img
                      key={i}
                      src={resolveImageUrl(img)}
                      alt=""
                      className="h-16 w-16 rounded object-cover"
                      onError={(e) =>
                        ((e.target as HTMLImageElement).style.display = "none")
                      }
                    />
                  ))}
                  {p.images.length > 6 && (
                    <div
                      className="flex h-16 w-16 items-center justify-center rounded text-xs"
                      style={{
                        background: "var(--adm-tag-bg)",
                        color: "var(--text-secondary)",
                      }}
                    >
                      +{p.images.length - 6}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
