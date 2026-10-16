"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import type { Album } from "@/lib/types";
import { resolveImageUrl } from "@/lib/url";

export default function AdminPhotosPage() {
  const [albums, setAlbums] = useState<Album[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  // 创建表单状态
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [dateLabel, setDateLabel] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadAlbums = () => {
    api
      .get<Album[]>("/api/albums")
      .then(setAlbums)
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadAlbums();
  }, []);

  // 创建
  const handleCreate = async () => {
    if (!name.trim()) {
      setError("名称不能为空");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      await api.post("/api/albums", {
        name: name.trim(),
        description: description.trim() || null,
        date_label: dateLabel.trim() || null,
      });
      // 重置表单
      setName("");
      setDescription("");
      setDateLabel("");
      setShowCreate(false);
      loadAlbums();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreating(false);
    }
  };

  // 删除
  const handleDelete = async (id: number, name: string) => {
    if (!confirm(`确定删除图片组「${name}」？此操作不可恢复。`)) return;
    try {
      await api.delete(`/api/albums/${id}`);
      loadAlbums();
    } catch (e) {
      alert(`删除失败：${(e as Error).message}`);
    }
  };

  if (loading) return <div>加载中...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">图片组管理</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="px-4 py-2 rounded-lg text-sm"
          style={{ background: "var(--accent)", color: "#fff" }}
        >
          + 新建图片组
        </button>
      </div>

      {/* 创建表单（弹窗） */}
      {showCreate && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.6)" }}
          onClick={() => setShowCreate(false)}
        >
          <div
            className="glass p-6 w-full max-w-md space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold mb-2">新建图片组</h2>

            <div>
              <label className="block text-xs mb-2" style={{ color: "var(--text-secondary)" }}>
                名称 *
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 focus:border-[var(--accent)] outline-none text-sm"
              />
            </div>

            <div>
              <label className="block text-xs mb-2" style={{ color: "var(--text-secondary)" }}>
                描述
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 focus:border-[var(--accent)] outline-none text-sm resize-none"
              />
            </div>

            <div>
              <label className="block text-xs mb-2" style={{ color: "var(--text-secondary)" }}>
                日期标签（如 2026.04）
              </label>
              <input
                type="text"
                value={dateLabel}
                onChange={(e) => setDateLabel(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 focus:border-[var(--accent)] outline-none text-sm"
              />
            </div>

            {error && (
              <div className="text-xs px-3 py-2 rounded" style={{ color: "#f87171", background: "rgba(248,113,113,0.1)" }}>
                {error}
              </div>
            )}

            <div className="flex gap-3 justify-end pt-2">
              <button
                onClick={() => setShowCreate(false)}
                className="px-4 py-2 rounded-lg text-sm border border-white/10 hover:bg-white/5"
              >
                取消
              </button>
              <button
                onClick={handleCreate}
                disabled={creating}
                className="px-4 py-2 rounded-lg text-sm disabled:opacity-50"
                style={{ background: "var(--accent)", color: "#fff" }}
              >
                {creating ? "创建中..." : "创建"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 图片组列表 */}
      {albums.length === 0 ? (
        <div className="glass p-16 text-center text-sm" style={{ color: "var(--text-secondary)" }}>
          还没有图片组，点右上角新建
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {albums.map((album) => (
            <div key={album.id} className="glass overflow-hidden">
              {/* 封面 */}
              <div className="relative aspect-video bg-white/5">
                {album.cover_path ? (
                  <img
                    src={resolveImageUrl(album.cover_path)}
                    alt={album.name}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = "none";
                    }}
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-3xl opacity-30">
                    🖼️
                  </div>
                )}
              </div>

              {/* 信息 */}
              <div className="p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-sm font-semibold truncate">{album.name}</h3>
                  {album.date_label && (
                    <span className="text-xs px-2 py-0.5 rounded flex-shrink-0" style={{ background: "rgba(124,92,255,0.15)", color: "var(--accent)" }}>
                      {album.date_label}
                    </span>
                  )}
                </div>
                <p className="text-xs line-clamp-2" style={{ color: "var(--text-secondary)" }}>
                  {album.description || "无描述"}
                </p>
                <div className="text-xs" style={{ color: "var(--text-secondary)" }}>
                  {album.photo_count} 张照片
                </div>

                <div className="flex gap-2 pt-2">
                  <Link
                    href={`/admin/photos/${album.id}`}
                    className="flex-1 text-center px-3 py-1.5 rounded text-xs border border-white/10 hover:bg-white/5"
                  >
                    编辑
                  </Link>
                  <button
                    onClick={() => handleDelete(album.id, album.name)}
                    className="px-3 py-1.5 rounded text-xs"
                    style={{ color: "#f87171", border: "1px solid rgba(248,113,113,0.3)" }}
                  >
                    删除
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}