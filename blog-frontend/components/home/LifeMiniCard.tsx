"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { MorphIcon } from "morphicons/react";
import { Heart, ArrowRight } from "lucide";
import { api } from "@/lib/api";
import type { LifePost } from "@/lib/types";
import { resolveImageUrl } from "@/lib/url";

const CARD_HEIGHT = 200;

export default function LifeMiniCard() {
  const [post, setPost] = useState<LifePost | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<LifePost[]>("/api/life?limit=1")
      .then((list) => {
        if (list && list.length > 0) setPost(list[0]);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading && !post) {
    return (
      <div
        className="life-mini-card"
        style={{ height: CARD_HEIGHT, opacity: 0.5 }}
      />
    );
  }

  return (
    <Link
      href="/life"
      className="life-mini-card"
      style={{ height: CARD_HEIGHT }}
    >
      {/* 顶部：标签 + 图标 */}
      <div className="life-mini-card__head">
        <span className="life-mini-card__tag">生活动态</span>
        <span className="life-mini-card__icon">
          <MorphIcon icon={Heart} size={13} />
        </span>
      </div>

      {/* 内容 */}
      <div className="life-mini-card__body">
        {post ? (
          <>
            <p className="life-mini-card__text">
              {post.content || "还没有动态"}
            </p>
            {post.images.length > 0 && (
              <div className="life-mini-card__thumb">
                <img
                  src={resolveImageUrl(post.images[0])}
                  alt=""
                  loading="lazy"
                />
              </div>
            )}
          </>
        ) : (
          <p className="life-mini-card__text">还没有动态</p>
        )}
      </div>

      {/* 底部：查看全部 */}
      <div className="life-mini-card__foot">
        <span>点击查看全文</span>
        <MorphIcon icon={ArrowRight} size={11} />
      </div>
    </Link>
  );
}