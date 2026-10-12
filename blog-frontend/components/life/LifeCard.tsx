"use client";

import { MorphIcon } from "morphicons/react";
import { Clock, MapPin, MessageCircle } from "lucide";
import type { LifePost } from "@/lib/types";
import { formatDateDots } from "@/lib/format";
import { resolveImageUrl } from "@/lib/url";

interface Props {
  post: LifePost;
  index: number;
  onClick: () => void;
  authorName: string;
  authorAvatar: string;
}

const MAX_IMAGES = 9;

export default function LifeCard({
  post,
  index,
  onClick,
  authorName,
  authorAvatar,
}: Props) {
  const total = post.images.length;
  const imgs = post.images.slice(0, MAX_IMAGES);
  const hiddenCount = total - MAX_IMAGES;

  // 1 张：单图；2 张及以上：九宫格
  const layoutClass =
    total === 0
      ? ""
      : total === 1
      ? "life-card__images--1"
      : "life-card__images--grid";

  return (
    <div
      className="life-grid-item"
      style={{ animationDelay: `${Math.min(index, 20) * 60}ms` }}
    >
      <div className="life-card" onClick={onClick}>
        {/* 头像 + 名字 + 日期 */}
        <div className="life-card__head">
          <div className="life-card__avatar">
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
          <div className="life-card__meta">
            <div className="life-card__name">{authorName}</div>
            <div className="life-card__date">
              <MorphIcon icon={Clock} size={11} />
              {formatDateDots(post.created_at)}
            </div>
          </div>
        </div>

        {/* 正文 */}
        {post.content && <p className="life-card__content">{post.content}</p>}

        {/* 图片 */}
        {imgs.length > 0 && (
          <div className={`life-card__images ${layoutClass}`}>
            {imgs.map((img, i) => {
              const isLast = i === MAX_IMAGES - 1 && hiddenCount > 0;
              return (
                <div key={i} className="life-card__img">
                  <img
                    src={resolveImageUrl(img)}
                    alt=""
                    loading="lazy"
                  />
                  {isLast && (
                    <div className="life-card__img-more">
                      +{hiddenCount}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* 底部：位置 + 评论按钮 */}
        <div className="life-card__foot">
          {post.location ? (
            <span className="life-card__location">
              <MorphIcon icon={MapPin} size={11} />
              {post.location}
            </span>
          ) : (
            <span />
          )}
          <span className="life-card__comment-btn" title="查看评论">
            <MorphIcon icon={MessageCircle} size={14} />
          </span>
        </div>
      </div>
    </div>
  );
}