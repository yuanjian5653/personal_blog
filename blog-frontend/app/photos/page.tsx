"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import type { Album } from "@/lib/types";
import { formatDateTimeSeconds } from "@/lib/format";
import { resolveThumbUrl } from "@/lib/url";
import {MorphIcon} from "morphicons/react";
import {Image as ImageIcon} from "lucide";

export default function PhotosPage() {
  const [albums, setAlbums] = useState<Album[]>([]);
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<Album[]>("/api/albums")
      .then(setAlbums)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const filtered = albums.filter(
    (a) =>
      a.name.toLowerCase().includes(keyword.toLowerCase()) ||
      (a.description || "").toLowerCase().includes(keyword.toLowerCase())
  );

  if (loading) {
    return <div style={{ color: "var(--text-secondary)" }}>加载中...</div>;
  }

  return (
    <div className="max-w-5xl mx-auto pt-2 space-y-10">
      {/* 顶部标题 + 搜索框 */}
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6">
        <div>
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 12,
                        marginBottom: 10,
                    }}
                >
                    <MorphIcon
                        icon={ImageIcon}
                        size={28}
                        style={{color: "var(--accent)"}}
                    />
                    <h1 className="archive-hero-title" style={{margin: 0}}>
                        图片墙
                    </h1>
                </div>
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            用照片记录生活的每一个瞬间
          </p>
        </div>

        <div
          className="flex items-center gap-3 h-11 px-5 rounded-full md:w-80"
          style={{
            background: "rgba(255,255,255,0.08)",
            backdropFilter: "blur(12px)",
            border: "1px solid rgba(255,255,255,0.1)",
          }}
        >
          <svg
            className="w-4 h-4 flex-shrink-0"
            style={{ color: "var(--text-secondary)" }}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索相册名或照片描述..."
            className="flex-1 bg-transparent border-none outline-none text-sm"
          />
        </div>
      </div>

      {/* 相册堆叠卡片网格 */}
      {filtered.length === 0 ? (
        <div
          className="glass p-16 text-center text-sm"
          style={{ color: "var(--text-secondary)" }}
        >
          {albums.length === 0 ? "还没有相册" : "没有匹配的结果"}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-12 px-4">
          {filtered.map((album, index) => (
            <Link
              key={album.id}
              href={`/photos/${album.id}`}
              className="group album-card-enter"
              style={{ animationDelay: `${index * 80}ms` }}
            >
              <div className="album-stack">
                {/* 三层照片，都是从封面 URL 加载，只是位置和旋转不同 */}
                {/* 准备 3 张图：优先预览图，不足时兜底 cover，再不足用占位 */}
                {(() => {
                  const pool =
                    album.preview_photos?.length > 0
                      ? album.preview_photos
                      : album.cover_path
                      ? [album.cover_path]
                      : [];
                  const renderPhoto = (
                    idx: number,
                    cls: string
                  ) => {
                    if (pool.length === 0) {
                      return (
                        <div
                          className={`album-stack__photo ${cls}`}
                          style={{ background: "rgba(30,32,40,0.9)" }}
                        />
                      );
                    }
                    const file = pool[idx % pool.length];
                    return (
                      <div
                        className={`album-stack__photo ${cls}`}
                        style={{ position: "absolute", inset: 0 }}
                      >
                        <img
                          src={resolveThumbUrl(file)}
                          alt=""
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            const img = e.target as HTMLImageElement;
                            if (img.src.includes("/media/thumbs/")) {
                              img.src = img.src.replace(
                                "/media/thumbs/",
                                "/media/photos/"
                              );
                            }
                          }}
                        />
                      </div>
                    );
                  };

                  return (
                    <>
                      {renderPhoto(2, "album-stack__photo--back")}
                      {renderPhoto(1, "album-stack__photo--middle")}
                      {renderPhoto(0, "album-stack__photo--front")}
                    </>
                  );
                })()}

                {/* 照片数徽标 */}
                <div className="album-stack__badge">
                  {album.photo_count} 张
                </div>
              </div>

              {/* 卡片下方信息 */}
              <div className="album-stack__meta">
                <div className="album-stack__title">{album.name}</div>
                <div className="album-stack__date">
                  {formatDateTimeSeconds(album.created_at)}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}