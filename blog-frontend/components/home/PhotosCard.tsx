"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useCachedFetch } from "@/lib/useCachedFetch";
import { api } from "@/lib/api";
import { resolveThumbUrl } from "@/lib/url";
import CardSkeleton from "./CardSkeleton";
import type { Album, AlbumDetail, Photo } from "@/lib/types";

interface PhotosData {
  album: Album | null;
  photos: Photo[];
}

export default function PhotosCard() {
  const router = useRouter();
  const [index, setIndex] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);

  const { data, loading } = useCachedFetch<PhotosData>(
    "home_photos_cache",
    async () => {
      // 拉配置 + 相册列表
      const [cfg, albums] = await Promise.all([
        api.get<{ configs: Record<string, string> }>("/api/site-config"),
        api.get<Album[]>("/api/albums"),
      ]);
      const configuredId = cfg.configs?.home_album_id;
      const list = albums || [];
      if (list.length === 0) return { album: null, photos: [] };

      let target = list[0];
      if (configuredId) {
        const found = list.find((a) => String(a.id) === configuredId);
        if (found) target = found;
      }

      const detail = await api.get<AlbumDetail>(`/api/albums/${target.id}`);

      return { album: target, photos: detail.photos || [] };
    },
    5 * 60 * 1000
  );

  // 轮播
  useEffect(() => {
    if (!data || data.photos.length <= 1) return;
    const timer = setInterval(() => {
      setIndex((i) => (i + 1) % data.photos.length);
    }, 4000);
    return () => clearInterval(timer);
  }, [data]);

  // 3D 追踪
  const handleMove = (e: React.MouseEvent) => {
    const wrap = wrapRef.current;
    const inner = innerRef.current;
    if (!wrap || !inner) return;
    const rect = wrap.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;
    inner.style.transform = `rotateX(${-y * 18}deg) rotateY(${x * 18}deg) scale(1.04)`;
  };

  const handleLeave = () => {
    const inner = innerRef.current;
    if (!inner) return;
    inner.style.transform = "rotateX(0deg) rotateY(0deg) scale(1)";
  };

  const handleClick = () => {
    router.push("/photos");
  };

  // 首次加载且无缓存
  if (loading && !data) {
    return <CardSkeleton lines={3} />;
  }

  const album = data?.album;
  const photos = data?.photos || [];

  if (!album || photos.length === 0) {
    return (
      <div className="tracker-wrap cursor-pointer card-lift" onClick={handleClick}>
        <div className="tracker-inner glass" style={{ padding: 0 }}>
          <div className="relative z-10 h-full flex flex-col justify-end p-6">
            <h2 className="text-lg font-semibold mb-1">图片墙</h2>
            <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
              还没有图片
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={wrapRef}
      className="tracker-wrap cursor-pointer"
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
      onClick={handleClick}
    >
      <div ref={innerRef} className="tracker-inner glass" style={{ padding: 0 }}>
        {photos.map((photo, i) => (
          <div
            key={photo.id}
            className="absolute inset-0 transition-opacity duration-1000"
            style={{ opacity: i === index ? 1 : 0 }}
          >
            <img
              src={resolveThumbUrl(photo.file_path)}
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
        ))}
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(to top, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0) 60%)",
          }}
        />

        <div className="relative z-10 h-full flex flex-col justify-end p-6">
          <p className="text-xs text-white/60 mb-1">
            {album.date_label || "图片集"}
          </p>
          <h2 className="text-lg font-semibold text-white">{album.name}</h2>
          <p className="text-xs text-white/70 mt-1">
            {photos.length} 张 · 自动轮播
          </p>

          {photos.length > 1 && (
            <div className="flex gap-1.5 mt-3">
              {photos.map((_, i) => (
                <span
                  key={i}
                  className="w-1.5 h-1.5 rounded-full transition-colors"
                  style={{
                    background:
                      i === index ? "var(--accent)" : "rgba(255,255,255,0.4)",
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}