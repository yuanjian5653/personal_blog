"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import type { AlbumDetail } from "@/lib/types";
import { resolveImageUrl, resolveThumbUrl } from "@/lib/url";
import { useMounted } from "@/lib/useMounted";

/** 简单的可复现伪随机（基于 id） */
function seededRandom(seed: number): number {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}

export default function AlbumDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = Number(params.id);
  const [album, setAlbum] = useState<AlbumDetail | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  // 是否已挂载（用于 createPortal 安全渲染）
  const mounted = useMounted();

  // 缩放与平移都记下"属于哪张图"，
  // 切图后读到的自然是默认值，不需要"切图就重置"的 effect。
  const [zoom, setZoom] = useState<{ at: number | null; scale: number }>({
    at: null,
    scale: 1,
  });
  const [panState, setPanState] = useState<{
    at: number | null;
    x: number;
    y: number;
  }>({ at: null, x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0 });

  const scale = zoom.at === lightboxIndex ? zoom.scale : 1;
  const offset =
    panState.at === lightboxIndex
      ? { x: panState.x, y: panState.y }
      : { x: 0, y: 0 };

  /** 设置缩放（只影响当前这张图） */
  const setScale = (v: number | ((prev: number) => number)) =>
    setZoom((p) => {
      const base = p.at === lightboxIndex ? p.scale : 1;
      return {
        at: lightboxIndex,
        scale: typeof v === "function" ? v(base) : v,
      };
    });

  /** 设置平移（只影响当前这张图） */
  const setOffset = (v: { x: number; y: number }) =>
    setPanState({ at: lightboxIndex, ...v });

  // 加载相册
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    api
      .get<AlbumDetail>(`/api/albums/${id}`)
      .then((a) => {
        if (!cancelled) setAlbum(a);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [id]);

  // loading 由 album 派生，避免在 effect 里同步 setState
  const loading = album === null;

  // 打开灯箱时锁定 body 滚动
  useEffect(() => {
    if (lightboxIndex === null) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [lightboxIndex]);

  // 缩放/平移操作
  const resetZoom = () => {
    setZoom({ at: lightboxIndex, scale: 1 });
    setPanState({ at: lightboxIndex, x: 0, y: 0 });
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const delta = e.deltaY > 0 ? -0.15 : 0.15;
    setScale((s) =>
      Math.max(0.5, Math.min(5, Number((s + delta).toFixed(2))))
    );
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (scale <= 1) return;
    setDragging(true);
    dragStartRef.current = {
      x: e.clientX - offset.x,
      y: e.clientY - offset.y,
    };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragging) return;
    setOffset({
      x: e.clientX - dragStartRef.current.x,
      y: e.clientY - dragStartRef.current.y,
    });
  };

  const handleMouseUp = () => {
    setDragging(false);
  };

  const handleDoubleClick = () => {
    if (scale > 1) {
      resetZoom();
    } else {
      setScale(2);
    }
  };

  // 键盘快捷键
  useEffect(() => {
    if (lightboxIndex === null) return;

    const handleKey = (e: KeyboardEvent) => {
      if (!album) return;
      if (e.key === "Escape") {
        setLightboxIndex(null);
      } else if (e.key === "ArrowLeft") {
        setLightboxIndex(
          (lightboxIndex - 1 + album.photos.length) % album.photos.length
        );
      } else if (e.key === "ArrowRight") {
        setLightboxIndex((lightboxIndex + 1) % album.photos.length);
      } else if (e.key === "0") {
        resetZoom();
      } else if (e.key === "+" || e.key === "=") {
        setScale((s) => Math.min(5, Number((s + 0.25).toFixed(2))));
      } else if (e.key === "-") {
        setScale((s) => Math.max(0.5, Number((s - 0.25).toFixed(2))));
      }
    };

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lightboxIndex, album]);

  if (loading) {
    return <div style={{ color: "var(--text-secondary)" }}>加载中...</div>;
  }

  if (!album) {
    return (
      <div className="max-w-3xl mx-auto pt-2">
        <div
          className="glass p-10 text-center text-sm"
          style={{ color: "var(--text-secondary)" }}
        >
          图片组不存在
        </div>
      </div>
    );
  }

  /* ====================== 灯箱内容（Portal 渲染到 body） ====================== */
  const lightboxContent =
    lightboxIndex !== null ? (
      <div
        className="fixed inset-0 flex flex-col"
        style={{
          // 关键：设置一个比任何 z-index 都大的值
          zIndex: 2147483647,
          // 模糊透明背景
          background: "rgba(10, 10, 18, 0.55)",
          backdropFilter: "blur(24px) saturate(140%)",
          WebkitBackdropFilter: "blur(24px) saturate(140%)",
          overflow: "hidden",
          touchAction: "none",
          overscrollBehavior: "contain",
        }}
        onClick={() => setLightboxIndex(null)}
        onWheel={(e) => e.stopPropagation()}
      >
        {/* 顶部工具栏 */}
        <div
          className="flex items-center justify-between px-6 py-3 flex-shrink-0"
          style={{
            background:
              "linear-gradient(to bottom, rgba(0,0,0,0.5), transparent)",
            zIndex: 10,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="text-sm text-white/80">
            {lightboxIndex + 1} / {album.photos.length}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() =>
                setScale((s) =>
                  Math.max(0.5, Number((s - 0.25).toFixed(2)))
                )
              }
              className="w-9 h-9 rounded-full flex items-center justify-center text-white/80 hover:bg-white/10 text-lg"
              title="缩小"
            >
              −
            </button>
            <span className="text-xs text-white/80 tabular-nums w-12 text-center">
              {Math.round(scale * 100)}%
            </span>
            <button
              onClick={() =>
                setScale((s) =>
                  Math.min(5, Number((s + 0.25).toFixed(2)))
                )
              }
              className="w-9 h-9 rounded-full flex items-center justify-center text-white/80 hover:bg-white/10 text-lg"
              title="放大"
            >
              ＋
            </button>
            <button
              onClick={resetZoom}
              className="ml-2 px-3 h-8 rounded-full flex items-center justify-center text-xs text-white/80 hover:bg-white/10"
              title="重置缩放（快捷键 0）"
            >
              重置
            </button>
          </div>

          <button
            onClick={() => setLightboxIndex(null)}
            className="w-9 h-9 rounded-full flex items-center justify-center text-white/80 hover:bg-white/10 text-2xl"
            title="关闭（ESC）"
          >
            ×
          </button>
        </div>

        {/* 主视图区 */}
        <div
          className="flex-1 relative overflow-hidden flex items-center justify-center"
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onDoubleClick={handleDoubleClick}
          onClick={(e) => e.stopPropagation()}
          style={{
            cursor: dragging ? "grabbing" : scale > 1 ? "grab" : "default",
            touchAction: "none",
          }}
        >
          <img
            src={resolveImageUrl(album.photos[lightboxIndex].file_path)}
            alt=""
            draggable={false}
            className="select-none"
            style={{
              maxWidth: "calc(100vw - 40px)",
              maxHeight: "calc(100vh - 160px)",
              width: "auto",
              height: "auto",
              transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
              transition: dragging ? "none" : "transform 0.2s ease-out",
              objectFit: "contain",
              userSelect: "none",
              display: "block",
              // 图片加个阴影提升层次
              filter: "drop-shadow(0 12px 40px rgba(0,0,0,0.5))",
            }}
          />

          {album.photos.length > 1 && (
            <>
              <button
                className="absolute left-6 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full flex items-center justify-center text-3xl text-white/70 hover:text-white hover:bg-white/10 transition-all"
                style={{
                  background: "rgba(255,255,255,0.08)",
                  backdropFilter: "blur(8px)",
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  setLightboxIndex(
                    (lightboxIndex - 1 + album.photos.length) %
                      album.photos.length
                  );
                }}
                title="上一张（←）"
              >
                ‹
              </button>
              <button
                className="absolute right-6 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full flex items-center justify-center text-3xl text-white/70 hover:text-white hover:bg-white/10 transition-all"
                style={{
                  background: "rgba(255,255,255,0.08)",
                  backdropFilter: "blur(8px)",
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  setLightboxIndex(
                    (lightboxIndex + 1) % album.photos.length
                  );
                }}
                title="下一张（→）"
              >
                ›
              </button>
            </>
          )}
        </div>

        {/* 底部信息 */}
        <div
          className="flex-shrink-0 px-6 py-4 text-center"
          style={{
            background:
              "linear-gradient(to top, rgba(0,0,0,0.5), transparent)",
            zIndex: 10,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {album.photos[lightboxIndex].title && (
            <p className="text-sm text-white/90 mb-1">
              {album.photos[lightboxIndex].title}
            </p>
          )}
          <p className="text-xs text-white/50">
            滚轮缩放 · 拖拽平移 · 双击重置 · ESC 关闭 · ←/→ 切换
          </p>
        </div>
      </div>
    ) : null;

  return (
    <div className="max-w-5xl mx-auto pt-2">
      {/* 返回按钮 */}
      <button
        onClick={() => router.push("/photos")}
        className="back-btn mb-8"
        style={
          {
            "--btn-text": '"返回画廊"',
          } as React.CSSProperties
        }
      >
        <svg
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          strokeWidth={2.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M10 19l-7-7m0 0l7-7m-7 7h18"
          />
        </svg>
        <p>返回画廊</p>
      </button>

      {/* 标题 */}
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-10 pb-6 border-b border-white/10">
        <div>
          <h1 className="text-3xl font-bold mb-2">{album.name}</h1>
          {album.description && (
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
              {album.description}
            </p>
          )}
        </div>
        <div
          className="text-xs px-4 py-2 rounded-full self-start"
          style={{
            background: "rgba(255,255,255,0.08)",
            border: "1px solid rgba(255,255,255,0.1)",
            color: "var(--text-secondary)",
          }}
        >
          共 {album.photo_count} 瞬间
        </div>
      </div>

            {/* 宝丽来风格照片网格 */}
      {album.photos.length === 0 ? (
        <div
          className="glass p-16 text-center text-sm"
          style={{ color: "var(--text-secondary)" }}
        >
          这个相册还没有照片
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-10 px-4">
          {album.photos.map((photo, i) => {
            const rnd = seededRandom(photo.id);
            const rotate = (rnd - 0.5) * 6;
            const tapeRotate = (seededRandom(photo.id + 1) - 0.5) * 30;

            return (
              <div
                key={photo.id}
                className="album-card-enter"
                style={{ animationDelay: `${i * 60}ms` }}
              >
                <button
                  onClick={() => setLightboxIndex(i)}
                  className="group block w-full transition-transform duration-300 hover:scale-[1.04] hover:z-10 relative"
                  style={{ transform: `rotate(${rotate}deg)` }}
                >
                  <div
                    className="relative p-3 pb-16"
                    style={{
                      background: "#fbfbf7",
                      boxShadow:
                        "0 4px 12px rgba(0,0,0,0.15), 0 12px 32px rgba(0,0,0,0.2)",
                      borderRadius: 2,
                    }}
                  >
                    <div
                      className="absolute left-1/2 -translate-x-1/2"
                      style={{
                        top: -8,
                        width: 60,
                        height: 20,
                        background: "rgba(255, 235, 130, 0.75)",
                        transform: `translateX(-50%) rotate(${tapeRotate}deg)`,
                        boxShadow: "0 2px 6px rgba(0,0,0,0.1)",
                        borderRadius: 1,
                      }}
                    />

                    <div
                      className="w-full aspect-square overflow-hidden"
                      style={{ background: "#eee" }}
                    >
                      <img
                        src={resolveThumbUrl(photo.file_path)}
                        alt={photo.title || ""}
                        className="w-full h-full object-cover"
                        loading="lazy"
                        onError={(e) => {
                          const img = e.target as HTMLImageElement;
                          // 缩略图 404 时回退到原图
                          if (img.src.includes("/media/thumbs/")) {
                            img.src = img.src.replace(
                              "/media/thumbs/",
                              "/media/photos/"
                            );
                          }
                        }}
                      />
                    </div>

                    <div
                      className="absolute left-0 right-0 text-center px-3"
                      style={{ bottom: 14, color: "#666" }}
                    >
                      <span
                        className="text-xs block"
                        style={{
                          fontFamily: "cursive",
                          display: "block",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          maxWidth: "100%",
                        }}
                        title={photo.title || `#${i + 1}`}
                      >
                        {photo.title || `#${i + 1}`}
                      </span>
                    </div>
                  </div>
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* 灯箱：用 Portal 渲染到 body，彻底脱离父容器约束 */}
      {mounted && lightboxContent && createPortal(lightboxContent, document.body)}
    </div>
  );
}