"use client";

import { useState } from "react";
import { MorphIcon } from "morphicons/react";
import { Clock, Heart, MapPin, MessageCircle } from "lucide";
import type { LifePost } from "@/lib/types";
import { formatDateDots } from "@/lib/format";
import { resolveImageUrl } from "@/lib/url";
import { toggleLifeLike } from "@/lib/comments";

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
  // 点赞：用列表接口给的初始值，点击后本地即时更新（失败再回滚）
  const [likes, setLikes] = useState(post.likes ?? 0);
  const [liked, setLiked] = useState(post.liked ?? false);
  const [liking, setLiking] = useState(false);
  const [needsLogin, setNeedsLogin] = useState(false);

  const handleLike = async (e: React.MouseEvent) => {
    // 卡片本身是"打开详情"，点赞不能连带打开
    e.stopPropagation();
    if (liking) return;

    // 没登录时后端返回 401（提示里带"登录"），直接给一句提示，不弹窗
    setLiking(true);
    try {
      const res = await toggleLifeLike(post.id);
      setLikes(res.likes);
      setLiked(res.liked);
      setNeedsLogin(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("登录")) setNeedsLogin(true);
      // 其它错误保持原状，不打断浏览
    } finally {
      setLiking(false);
    }
  };

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
          <span className="life-card__actions">
            <button
              type="button"
              className={`life-card__like${liked ? " is-on" : ""}`}
              onClick={handleLike}
              disabled={liking}
              aria-pressed={liked}
              aria-label={liked ? "取消点赞" : "点赞"}
              title={liked ? "取消点赞" : "点赞"}
            >
              <MorphIcon icon={Heart} size={14} />
              <span>{likes}</span>
            </button>

            <span className="life-card__comment-btn" title="查看评论">
              <MorphIcon icon={MessageCircle} size={14} />
            </span>
          </span>
        </div>

        {needsLogin && (
          <p className="life-card__login-hint">
            需要先用 GitHub 登录才能点赞
          </p>
        )}
      </div>
    </div>
  );
}