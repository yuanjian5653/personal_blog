"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { MorphIcon } from "morphicons/react";
import { Heart, MessageCircle } from "lucide";
import { api } from "@/lib/api";
import type { Essay } from "@/lib/types";
import { relativeTime } from "@/lib/format";
import { resolveImageUrl } from "@/lib/url";
import { useMounted } from "@/lib/useMounted";
import LifeImageLightbox from "@/components/life/LifeImageLightbox";

interface Props {
  essay: Essay;
  onClose: () => void;
  onLikeUpdate: (id: number, likes: number) => void;
}

export default function EssayDetailModal({
  essay,
  onClose,
  onLikeUpdate,
}: Props) {
  const mounted = useMounted();
  // likes 的初值来自 essay；点过赞后由本组件接管。
  // 父组件用 key={essay.id} 渲染本组件，所以切换到另一条说说会重新挂载，
  // 不需要"props 变化就同步 state"的 effect。
  const [likes, setLikes] = useState(essay.likes);
  const [liking, setLiking] = useState(false);
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);

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

  const images = essay.images;
  const imgClass =
    images.length === 1
      ? "essay-detail-images--1"
      : images.length === 2
      ? "essay-detail-images--2"
      : images.length === 3
      ? "essay-detail-images--3"
      : "essay-detail-images--more";

  const handleLike = async () => {
    if (liking) return;
    setLiking(true);
    try {
      const res = await api.post<{ likes: number }>(
        `/api/essays/${essay.id}/like`
      );
      setLikes(res.likes);
      onLikeUpdate(essay.id, res.likes);
    } catch {}
    setLiking(false);
  };

  const content = (
    <div className="essay-detail-backdrop" onClick={onClose}>
      <button
        className="life-detail-close"
        onClick={onClose}
        title="关闭（ESC）"
      >
        ×
      </button>

      <div
        className="essay-detail-modal"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 作者头 */}
        <div className="essay-detail-head">
          <div className="essay-detail-avatar">
            <MorphIcon icon={MessageCircle} size={18} />
          </div>
          <div>
            <div className="essay-detail-name">博主</div>
            <div className="essay-detail-time">
              {relativeTime(essay.created_at, "cn")}
            </div>
          </div>
        </div>

        {/* 完整内容 */}
        {essay.title && (
          <h3 className="essay-detail-title">{essay.title}</h3>
        )}
        <p className="essay-detail-content">
          {essay.content || "（无内容）"}
        </p>

        {/* 图片网格 */}
        {images.length > 0 && (
          <div className={`essay-detail-images ${imgClass}`}>
            {images.map((img, i) => (
              <div
                key={i}
                className="essay-detail-image"
                onClick={() => setLightboxIdx(i)}
              >
                <img src={resolveImageUrl(img)} alt="" loading="lazy" />
              </div>
            ))}
          </div>
        )}

        {/* 互动区 */}
        <div className="essay-detail-actions">
          <button
            className={`essay-detail-like ${liking ? "liking" : ""}`}
            onClick={handleLike}
            title="点赞"
          >
            <MorphIcon icon={Heart} size={14} />
            <span>{likes}</span>
          </button>

          <div className="essay-detail-hint">点击图片可放大</div>
        </div>

        {/* 评论区（占位） */}
        <div className="essay-detail-comments">
          <div className="essay-detail-comments-header">
            <MorphIcon icon={MessageCircle} size={13} />
            评论
          </div>
          <div className="essay-detail-comments-empty">
            评论功能开发中，敬请期待～
          </div>
          <div className="essay-detail-comments-form">
            <textarea
              className="essay-detail-comments-input"
              placeholder="说点什么吧……"
              disabled
            />
            <div className="essay-detail-comments-actions">
              <button className="essay-detail-comments-submit" disabled>
                发表评论
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {createPortal(content, document.body)}
      {lightboxIdx !== null && images.length > 0 && (
        <LifeImageLightbox
          images={images.map((p) => resolveImageUrl(p))}
          index={lightboxIdx}
          onClose={() => setLightboxIdx(null)}
          onChangeIndex={setLightboxIdx}
        />
      )}
    </>
  );
}