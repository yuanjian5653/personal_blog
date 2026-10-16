"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import type { Essay } from "@/lib/types";
import { formatDateTime } from "@/lib/format";
import { resolveImageUrl } from "@/lib/url";

export default function AdminEssaysPage() {
  // null 表示"还没加载完"，loading 直接由它派生，避免在 effect 里同步 setState
  const [essays, setEssays] = useState<Essay[] | null>(null);
  const loading = essays === null;

  const load = () => {
    api
      .get<Essay[]>("/api/essays")
      .then(setEssays)
      .catch(() => setEssays([]));
  };

  useEffect(() => {
    load();
  }, []);

  const handleDelete = async (id: number, title: string) => {
    const name = title || "(无标题)";
    if (!confirm(`确定删除这条说说「${name}」？`)) return;
    try {
      await api.delete(`/api/essays/${id}`);
      setEssays((prev) => (prev ?? []).filter((e) => e.id !== id));
    } catch (e) {
      alert(`删除失败：${(e as Error).message}`);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">说说管理</h1>
        <Link
          href="/admin/essays/new"
          className="px-4 py-2 rounded-lg text-sm"
          style={{ background: "var(--accent)", color: "#fff" }}
        >
          + 写说说
        </Link>
      </div>

      {loading ? (
        <div style={{ color: "var(--text-secondary)" }}>加载中...</div>
      ) : essays.length === 0 ? (
        <div
          className="glass p-16 text-center text-sm"
          style={{ color: "var(--text-secondary)" }}
        >
          还没有说说
        </div>
      ) : (
        <div className="space-y-3">
          {essays.map((e) => (
            <div
              key={e.id}
              className="glass p-4 group hover:bg-white/5 transition-colors"
              style={{ borderRadius: 12 }}
            >
              {/* 头部：时间 + 点赞 + 图片数 */}
              <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
                <div className="flex items-center gap-3">
                  <span
                    className="text-xs"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    {formatDateTime(e.created_at)}
                  </span>
                  {e.images.length > 0 && (
                    <span
                      className="text-[10px] px-1.5 py-0.5 rounded"
                      style={{
                        background: "rgba(124,92,255,0.15)",
                        color: "var(--accent)",
                      }}
                    >
                      🖼 {e.images.length}
                    </span>
                  )}
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded"
                    style={{
                      background: "rgba(255,45,155,0.12)",
                      color: "#ff2d9b",
                    }}
                  >
                    ♡ {e.likes}
                  </span>
                </div>

                {/* 操作 */}
                <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Link
                    href={`/admin/essays/${e.id}`}
                    className="text-xs px-3 py-1.5 rounded hover:bg-white/10"
                  >
                    编辑
                  </Link>
                  <button
                    onClick={() => handleDelete(e.id, e.title)}
                    className="text-xs px-3 py-1.5 rounded"
                    style={{ color: "#f87171" }}
                  >
                    删除
                  </button>
                </div>
              </div>

              {/* 标题 */}
              {e.title && (
                <h3 className="text-sm font-semibold mb-1.5">{e.title}</h3>
              )}

              {/* 内容 */}
              <p
                className="text-xs line-clamp-2 mb-2"
                style={{ color: "var(--text-secondary)" }}
              >
                {e.content || "(无内容)"}
              </p>

              {/* 图片缩略图 */}
              {e.images.length > 0 && (
                <div className="flex gap-2 flex-wrap">
                  {e.images.slice(0, 6).map((img, i) => (
                    <img
                      key={i}
                      src={resolveImageUrl(img)}
                      alt=""
                      className="w-14 h-14 rounded object-cover bg-white/5"
                      onError={(e) =>
                        ((e.target as HTMLImageElement).style.display = "none")
                      }
                    />
                  ))}
                  {e.images.length > 6 && (
                    <div
                      className="w-14 h-14 rounded flex items-center justify-center text-xs"
                      style={{
                        background: "var(--adm-tag-bg)",
                        color: "var(--text-secondary)",
                      }}
                    >
                      +{e.images.length - 6}
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