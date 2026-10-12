"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { API_BASE } from "@/lib/api";
import type { ArticleListItem } from "@/lib/types";
import { formatDateTime } from "@/lib/format";
import { resolveImageUrl } from "@/lib/url";
import { useRouter } from "next/navigation";

export default function AdminPostsPage() {
  // Word 导入相关
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const router = useRouter();
  // null = 尚未加载完；loading 由它派生，避免在 effect 里同步 setState
  const [articles, setArticles] = useState<ArticleListItem[] | null>(null);
  const loading = articles === null;

  const load = () => {
    api
      .get<ArticleListItem[]>(`/api/articles?status=`)
      .then(setArticles)
      .catch(() => setArticles([]));
  };

  useEffect(() => {
    load();
  }, []);

    // 处理 Word 文件上传
  const handleWordImport = async (file: File) => {
    setImporting(true);
    setImportError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch(`${API_BASE}/api/articles/parse-word`, {
        method: "POST",
        body: formData,
        credentials: "include",
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `解析失败 (${res.status})`);
      }

      const data = await res.json();

      // 把解析结果存到 sessionStorage，编辑器启动时读取
      sessionStorage.setItem(
        "word_import_pending",
        JSON.stringify({
          title: data.title,
          content: data.content,
        })
      );

      // 跳转到新建文章页
      router.push("/admin/posts/new");
    } catch (e) {
      setImportError((e as Error).message);
    } finally {
      setImporting(false);
    }
  };

  const handleDelete = async (id: number, title: string) => {
    if (!confirm(`确定删除《${title}》？`)) return;
    try {
      await api.delete(`/api/articles/${id}`);
      setArticles((prev) => (prev ?? []).filter((a) => a.id !== id));
    } catch (e) {
      alert(`删除失败：${(e as Error).message}`);
    }
  };

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <h1 className="text-2xl font-bold">文章管理</h1>

        <div className="flex items-center gap-3">
          {/* 导入 Word 按钮 */}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
            className="px-4 py-2 rounded-lg text-sm border border-white/10 hover:bg-white/5 transition-colors disabled:opacity-50"
            title="从 Word 文档导入"
          >
            {importing ? "解析中..." : "📄 导入 Word"}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".docx"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleWordImport(f);
              e.target.value = "";
            }}
          />

          <Link
            href="/admin/posts/new"
            className="px-4 py-2 rounded-lg text-sm"
            style={{ background: "var(--accent)", color: "#fff" }}
          >
            + 新建文章
          </Link>
        </div>
      </div>

      {/* 导入错误提示 */}
      {importError && (
        <div
          className="text-sm px-4 py-2 rounded-lg"
          style={{
            background: "rgba(248,113,113,0.1)",
            color: "#f87171",
          }}
        >
          导入失败：{importError}
        </div>
      )}

      {loading ? (
        <div style={{ color: "var(--text-secondary)" }}>加载中...</div>
      ) : articles.length === 0 ? (
        <div
          className="glass p-16 text-center text-sm"
          style={{ color: "var(--text-secondary)" }}
        >
          还没有文章
        </div>
      ) : (
        <div className="glass p-2">
          {articles.map((a) => (
            <div
              key={a.id}
              className="flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-white/5 transition-colors group"
            >
              <div
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{
                  background:
                    a.status === "published" ? "#4ade80" : "#facc15",
                }}
              />

              {a.cover_path ? (
                <img
                  src={resolveImageUrl(a.cover_path)}
                  alt=""
                  className="w-12 h-12 rounded object-cover flex-shrink-0"
                  onError={(e) =>
                    ((e.target as HTMLImageElement).style.display = "none")
                  }
                />
              ) : (
                <div className="w-12 h-12 rounded bg-white/5 flex-shrink-0 flex items-center justify-center text-lg">
                  📄
                </div>
              )}

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-medium truncate">
                    {a.title}
                  </span>
                  {a.is_pinned && (
                    <span
                      className="text-[10px] px-1.5 py-0.5 rounded"
                      style={{ background: "var(--accent)", color: "#fff" }}
                    >
                      置顶
                    </span>
                  )}
                  {a.category && (
                    <span
                      className="text-[10px] px-1.5 py-0.5 rounded"
                      style={{
                        background: "rgba(255,255,255,0.08)",
                        color: "var(--text-secondary)",
                      }}
                    >
                      {a.category}
                    </span>
                  )}
                </div>
                <div
                  className="text-xs flex gap-3"
                  style={{ color: "var(--text-secondary)" }}
                >
                  <span>{formatDateTime(a.created_at)}</span>
                  <span>👁 {a.view_count}</span>
                  <span>♡ {a.like_count}</span>
                </div>
              </div>

              <div className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-2">
                <Link
                  href={`/admin/posts/${a.id}`}
                  className="text-xs px-3 py-1.5 rounded hover:bg-white/10"
                >
                  编辑
                </Link>
                <button
                  onClick={() => handleDelete(a.id, a.title)}
                  className="text-xs px-3 py-1.5 rounded"
                  style={{ color: "#f87171" }}
                >
                  删除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}