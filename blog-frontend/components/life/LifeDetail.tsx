"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { MorphIcon } from "morphicons/react";
import { Clock, MapPin, MessageCircle, Grid3x3, Play } from "lucide";
import type { LifePost } from "@/lib/types";
import { api } from "@/lib/api";
import { formatDateTimeCN } from "@/lib/format";
import { resolveImageUrl } from "@/lib/url";
import { useMounted } from "@/lib/useMounted";
import LifeImageLightbox from "./LifeImageLightbox";

function seededRandom(seed: number): number {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}

interface Props {
  post: LifePost;
  authorName: string;
  authorAvatar: string;
  onClose: () => void;
}

/** 完整月历卡片 */
function LifeCalendar({ date }: { date: string }) {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = d.getMonth();
  const publishDay = d.getDate();

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();

  const cells: { day: number; current: boolean; highlight: boolean }[] = [];

  for (let i = firstDay - 1; i >= 0; i--) {
    cells.push({ day: daysInPrevMonth - i, current: false, highlight: false });
  }
  for (let i = 1; i <= daysInMonth; i++) {
    cells.push({ day: i, current: true, highlight: i === publishDay });
  }
  const remaining = cells.length % 7;
  if (remaining !== 0) {
    for (let i = 1; i <= 7 - remaining; i++) {
      cells.push({ day: i, current: false, highlight: false });
    }
  }

  const monthName = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ][month];

  return (
    <div className="life-detail-card life-calendar">
      <div className="life-calendar-header">
        <span className="life-calendar-month">{monthName}</span>
        <span className="life-calendar-divider" />
        <span className="life-calendar-year">{year}</span>
      </div>

      <div className="life-calendar-weekdays">
        {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((w) => (
          <div key={w} className="life-calendar-weekday">
            {w}
          </div>
        ))}
      </div>

      <div className="life-calendar-days">
        {cells.map((c, i) => (
          <div
            key={i}
            className={`life-calendar-day ${
              !c.current ? "other-month" : ""
            } ${c.highlight ? "highlight" : ""}`}
          >
            {c.day}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function LifeDetail({
  post,
  authorName,
  authorAvatar,
  onClose,
}: Props) {
  const mounted = useMounted();

  // 图片墙回退
  const [albumImages, setAlbumImages] = useState<string[]>([]);
  const [imgView, setImgView] = useState<"carousel" | "grid">("grid");
  // 轮播索引带上"属于哪条动态"：换了 post.id 后读取自然是 0，
  // 不需要"切换动态就重置"的 effect。
  const [carousel, setCarousel] = useState({ at: post.id, idx: 0 });
  const carouselIdx = carousel.at === post.id ? carousel.idx : 0;
  const setCarouselIdx = (
    v: number | ((prev: number) => number)
  ) =>
    setCarousel((p) => {
      const base = p.at === post.id ? p.idx : 0;
      return { at: post.id, idx: typeof v === "function" ? v(base) : v };
    });

  // 灯箱
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);

  const hasImgs = post.images && post.images.length > 0;

  // 无图片时从图片墙取图
  useEffect(() => {
    if (hasImgs) return;
    let cancelled = false;
    api
      .get<{ id: number }[]>("/api/albums")
      .then((list) => {
        if (cancelled || !list || list.length === 0) return;
        return api
          .get<{ photos: { file_path: string }[] }>(
            `/api/albums/${list[0].id}`
          )
          .then((detail) => {
            if (!cancelled) {
              setAlbumImages((detail.photos || []).map((p) => p.file_path));
            }
          });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [hasImgs]);

  // 统一的图片数据源
  const displayImages = hasImgs ? post.images : albumImages;

  // 轮播（针对统一数据源）
  useEffect(() => {
    if (imgView !== "carousel" || displayImages.length <= 1) return;
    const t = setInterval(() => {
      setCarouselIdx((i) => (i + 1) % displayImages.length);
    }, 4000);
    return () => clearInterval(t);
    // setCarouselIdx 依赖 post.id，这里用 displayImages.length 已经能覆盖重启时机
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imgView, displayImages.length]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  if (!mounted) return null;
  // 灯箱用的完整 URL 数组
  const lightboxImages = displayImages.map((p) => resolveImageUrl(p));

  // 随机偏移
  const seed = post.id;
  const imgOffsetY = (seededRandom(seed * 7 + 1) - 0.5) * 80;
  const calOffsetY = (seededRandom(seed * 7 + 2) - 0.5) * 80;

  const content = (
    <div className="life-detail-backdrop" onClick={onClose}>
      <button
        className="life-detail-close"
        onClick={onClose}
        title="关闭（ESC）"
      >
        ×
      </button>

      <div className="life-detail-wrap" onClick={(e) => e.stopPropagation()}>
        {/* ===== 左列：图片组 ===== */}
        <div
          className="life-detail-col-left"
          style={{ "--img-offset": `${imgOffsetY}px` } as React.CSSProperties}
        >
          {displayImages.length > 0 && (
            <div className="life-detail-card life-detail-images-box">
              {/* 头部：标题 + 切换按钮 */}
              <div className="life-detail-images-box-head">
                <span className="life-detail-images-box-title">
                  {hasImgs ? "动态图片" : "图片墙"}
                  <span className="life-detail-images-box-count">
                    {displayImages.length}
                  </span>
                </span>
                <button
                  className="life-detail-images-box-toggle"
                  onClick={() =>
                    setImgView((v) =>
                      v === "carousel" ? "grid" : "carousel"
                    )
                  }
                  title={imgView === "carousel" ? "切换九宫格" : "切换轮播"}
                >
                  {imgView === "carousel" ? (
                    <MorphIcon icon={Grid3x3} size={12} />
                  ) : (
                    <MorphIcon icon={Play} size={12} />
                  )}
                </button>
              </div>

              {/* 内容区：固定高度 */}
              {imgView === "carousel" ? (
                <div className="life-detail-carousel">
                  {displayImages.map((img, i) => (
                    <img
                      key={i}
                      src={resolveImageUrl(img)}
                      alt=""
                      style={{ opacity: i === carouselIdx ? 1 : 0 }}
                      loading="lazy"
                      onClick={() => setLightboxIdx(i)}
                    />
                  ))}
                  {displayImages.length > 1 && (
                    <div className="life-detail-carousel-dots">
                      {displayImages.map((_, i) => (
                        <span
                          key={i}
                          className={`life-detail-carousel-dot ${
                            i === carouselIdx ? "active" : ""
                          }`}
                        />
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="life-detail-images-wall">
                  {displayImages.slice(0, 9).map((img, i) => (
                    <div
                      key={i}
                      className="life-detail-image"
                      onClick={() => setLightboxIdx(i)}
                    >
                      <img src={resolveImageUrl(img)} alt="" loading="lazy" />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ===== 中列：主卡片 + 评论 ===== */}
        <div className="life-detail-col-center">
          <div className="life-detail-card life-detail-card--main">
            <div className="life-detail-author">
              <div className="life-detail-avatar">
                {authorAvatar ? (
                  <img
                    src={resolveImageUrl(authorAvatar)}
                    alt={authorName}
                    onError={(e) =>
                      ((e.target as HTMLImageElement).style.display = "none")
                    }
                  />
                ) : (
                  authorName[0] || "我"
                )}
              </div>
              <div>
                <div className="life-detail-name">{authorName}</div>
                <div className="life-detail-date">
                  <MorphIcon icon={Clock} size={12} />
                  {formatDateTimeCN(post.created_at)}
                </div>
              </div>
            </div>

            {post.content && (
              <p className="life-detail-content">{post.content}</p>
            )}

            {post.location && (
              <div className="life-detail-location">
                <MorphIcon icon={MapPin} size={12} />
                {post.location}
              </div>
            )}
          </div>

          <div className="life-detail-card life-detail-comments">
            <div className="life-detail-comments-header">
              <MorphIcon icon={MessageCircle} size={14} />
              评论区
            </div>

            <div className="life-detail-comments-list">
              评论功能开发中，敬请期待～
            </div>

            <div className="life-detail-comments-form">
              <textarea
                className="life-detail-comments-input"
                placeholder="说点什么吧……"
                disabled
              />
              <div className="life-detail-comments-actions">
                <button className="life-detail-comments-submit" disabled>
                  发表评论
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* ===== 右列：日历 ===== */}
        <div
          className="life-detail-col-right"
          style={{ "--cal-offset": `${calOffsetY}px` } as React.CSSProperties}
        >
          <LifeCalendar date={post.created_at} />
        </div>
      </div>
    </div>
  );

  return (
    <>
      {createPortal(content, document.body)}
      {lightboxIdx !== null && lightboxImages.length > 0 && (
        <LifeImageLightbox
          images={lightboxImages}
          index={lightboxIdx}
          onClose={() => setLightboxIdx(null)}
          onChangeIndex={setLightboxIdx}
        />
      )}
    </>
  );
}