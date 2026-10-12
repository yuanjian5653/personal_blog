"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { MorphIcon } from "morphicons/react";
import { MessageSquare, Image as ImageIcon, Heart } from "lucide";
import { api } from "@/lib/api";
import type { Essay } from "@/lib/types";
import { relativeTime } from "@/lib/format";
import { resolveImageUrl } from "@/lib/url";
import CardSkeleton from "./CardSkeleton";

const CARD_HEIGHT = 200;

export default function EssayCard() {
  const [essay, setEssay] = useState<Essay | null>(null);
  const [loading, setLoading] = useState(true);

  // 加载最新一条说说
  useEffect(() => {
    api
      .get<Essay[]>("/api/essays?limit=1")
      .then((list) => {
        if (list && list.length > 0) setEssay(list[0]);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading && !essay) {
    return (
      <div style={{ height: CARD_HEIGHT }}>
        <CardSkeleton lines={3} className="h-full" />
      </div>
    );
  }

  if (!essay) {
    return (
      <Link
        href="/essays"
        className="essay-card glass"
        style={{ height: CARD_HEIGHT }}
      >
        <div className="essay-card__content">
          <div className="essay-card__head">
            <span className="essay-card__tag">说说</span>
          </div>
          <p className="essay-card__text">还没有说说</p>
        </div>
      </Link>
    );
  }

  const images = essay.images || [];
  const imagesCount = images.length;

  return (
    <Link
      href="/essays"
      className="essay-card glass"
      style={{ height: CARD_HEIGHT }}
    >
      {/* 星光装饰层 */}
      <div className="essay-card__stars-layer" aria-hidden="true">
        <div className="essay-card__stars essay-card__stars--1" />
        <div className="essay-card__stars essay-card__stars--2" />
      </div>

      {/* 内容 */}
      <div className="essay-card__content">
        {/* 顶部：标签 + 时间 */}
        <div className="essay-card__head">
          <div className="essay-card__head-left">
            <span className="essay-card__tag">
              <MorphIcon icon={MessageSquare} size={11} />
              说说
            </span>
            <span className="essay-card__time">
              {relativeTime(essay.created_at)}
            </span>
          </div>
          {imagesCount > 0 && (
            <span className="essay-card__badge">
              <MorphIcon icon={ImageIcon} size={10} />
              {imagesCount}
            </span>
          )}
        </div>

        {/* 正文 */}
        <p className="essay-card__text">
          {essay.content || essay.title || "（无内容）"}
        </p>

        {/* 底部：缩略图 或 点赞数 */}
        <div className="essay-card__foot">
          {images.length > 0 ? (
            <div className="essay-card__thumbs">
              {images.slice(0, 3).map((img, i) => (
                <div key={i} className="essay-card__thumb">
                  <img
                    src={resolveImageUrl(img)}
                    alt=""
                    loading="lazy"
                  />
                </div>
              ))}
              {images.length > 3 && (
                <div className="essay-card__thumb essay-card__thumb--more">
                  +{images.length - 3}
                </div>
              )}
            </div>
          ) : (
            <div className="essay-card__likes">
              <MorphIcon icon={Heart} size={12} />
              <span>{essay.likes}</span>
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}