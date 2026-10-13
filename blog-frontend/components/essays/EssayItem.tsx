"use client";

import { useEffect, useState } from "react";

import type { Essay } from "@/lib/types";
import { formatDateTime, relativeTime } from "@/lib/format";
import { resolveImageUrl } from "@/lib/url";
import {
  currentPath,
  fetchEssayLikes,
  fetchViewer,
  githubLoginUrl,
  toggleEssayLike,
} from "@/lib/comments";
import LifeImageLightbox from "@/components/life/LifeImageLightbox";
import Comments from "@/components/comments/Comments";

/**
 * 由 id 生成稳定的伪随机倾斜角。
 *
 * 用 id 做种子而不是 Math.random()：组件在服务端与客户端都会渲染，
 * 随机会导致 hydration 不一致（两次渲染角度不同）。
 */
function tiltOf(id: number): number {
  const x = Math.sin(id * 12.9898) * 43758.5453;
  const frac = x - Math.floor(x); // 0..1
  return Number(((frac - 0.5) * 7).toFixed(2)); // -3.5deg .. 3.5deg
}

/** 折叠时的卡片高度（只够一行正文） */
const COLLAPSED_HEIGHT = 96;
/** 折叠时每条露出的高度（只露出上一条的头部） */
const COLLAPSED_PEEK = 34;
/** 折叠时向上拉的距离，形成叠压 */
const PEEK_OVERLAP = COLLAPSED_PEEK - COLLAPSED_HEIGHT;

interface Props {
  essay: Essay;
  /** 在同一天里的序号，用于决定叠压与层级 */
  index: number;
  expanded: boolean;
  /** 同一组里是否有"更靠上"的卡片处于展开状态 */
  prevExpanded: boolean;
  onToggle: () => void;
  onLikeUpdate: (id: number, likes: number) => void;
}

export default function EssayItem({
  essay,
  index,
  expanded,
  prevExpanded,
  onToggle,
  onLikeUpdate,
}: Props) {
  const [likes, setLikes] = useState(essay.likes);
  const [liked, setLiked] = useState(false);
  const [liking, setLiking] = useState(false);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  // 评论区：默认收起，点「评论」再下拉展开
  const [showComments, setShowComments] = useState(false);
  // 登录态由评论区那次请求决定，这里只需知道"有没有登录"
  const [loggedIn, setLoggedIn] = useState(false);

  const images = essay.images || [];
  const tilt = tiltOf(essay.id);

  // 叠压：第 2 条起向上拉，只露出前一条的头部。
  // 两种情况必须归零，否则会盖住上面那张的展开内容：
  //   1. 自己展开了
  //   2. 上面有任意一张处于展开状态（上面那张变高了，不能再往上拉）
  const overlap = expanded || prevExpanded ? 0 : index === 0 ? 0 : PEEK_OVERLAP;

  // 展开后才知道"我是否已赞过"。列表接口只给了总数，点赞态要单独查。
  useEffect(() => {
    if (!expanded) return;
    let cancelled = false;

    fetchViewer()
      .then((v) => {
        if (!cancelled) setLoggedIn(v !== null);
      })
      .catch(() => {});

    fetchEssayLikes(essay.id)
      .then((res) => {
        if (cancelled) return;
        setLikes(res.likes);
        setLiked(res.liked);
        onLikeUpdate(essay.id, res.likes);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
    // onLikeUpdate 来自父组件且未 memo 化，放进依赖会导致重复请求
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, essay.id]);

  const handleLike = async () => {
    // 点赞需要登录：未登录直接把人引到 GitHub 授权
    if (!loggedIn) {
      setNeedsLogin(true);
      return;
    }
    if (liking) return;
    setLiking(true);
    setNeedsLogin(false);
    try {
      const res = await toggleEssayLike(essay.id);
      setLikes(res.likes);
      setLiked(res.liked);
      onLikeUpdate(essay.id, res.likes);
    } catch {
      // 点赞失败就保持原状，不打断阅读
    } finally {
      setLiking(false);
    }
  };

  return (
    <>
      <article
        className={`essay-item${expanded ? " is-expanded" : ""}`}
        style={{
          marginTop: overlap,
          height: expanded ? "auto" : COLLAPSED_HEIGHT,
          transform: `rotate(${tilt}deg)`,
          // 后放的纸条压在上面；展开的那条再抬一层
          zIndex: expanded ? 50 : index + 1,
        }}
      >
        {/* 可点区域（按钮语义，支持键盘） */}
        <button
          type="button"
          className="essay-item-toggle-area"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-label={expanded ? "收起这条说说" : "展开这条说说"}
        >
          <div className="essay-item-head">
            <span className="essay-item-time">
              {relativeTime(essay.created_at)}
            </span>
            <span className="flex items-center">
              {images.length > 0 && (
                <span className="essay-item-badge">{images.length} 图</span>
              )}
              <span className="essay-item-toggle" aria-hidden>
                ▾
              </span>
            </span>
          </div>

          {/* 折叠时只显示一行（超出省略号）；展开后完整显示 */}
          <p className="essay-item-content">
            {essay.content || essay.title || "（无内容）"}
          </p>
        </button>

        {/* 展开后的详细内容 */}
        {expanded && (
          <div className="essay-item-detail">
            {images.length > 0 && (
              <div className="essay-item-detail__images">
                {images.slice(0, 6).map((img, i) => (
                  <img
                    key={i}
                    src={resolveImageUrl(img)}
                    alt=""
                    loading="lazy"
                    onClick={(e) => {
                      e.stopPropagation();
                      setLightboxIdx(i);
                    }}
                  />
                ))}
                {images.length > 6 && (
                  <div className="essay-item-detail__more">
                    +{images.length - 6}
                  </div>
                )}
              </div>
            )}

            <div className="essay-item-detail__foot">
              <span className="essay-item-detail__date">
                {formatDateTime(essay.created_at)}
              </span>

              <div className="essay-item-detail__actions">
                {/* 评论按钮：点一下把评论区下拉出来 */}
                <button
                  type="button"
                  className={`essay-item-action${showComments ? " is-on" : ""}`}
                  onClick={() => setShowComments((v) => !v)}
                  aria-expanded={showComments}
                  aria-label={showComments ? "收起评论" : "展开评论"}
                >
                  💬 评论
                </button>

                <button
                  type="button"
                  className={`essay-item-like${liked ? " is-on" : ""}`}
                  onClick={handleLike}
                  disabled={liking}
                  aria-pressed={liked}
                  aria-label={liked ? "取消点赞" : "点赞"}
                  title={loggedIn ? "点赞" : "登录后可点赞"}
                >
                  {liked ? "♥" : "♡"} {likes}
                </button>
              </div>
            </div>

            {/* 未登录时点赞的提示 */}
            {needsLogin && (
              <p className="essay-item-login-hint">
                需要先用 GitHub 登录才能点赞 ——{" "}
                <a href={githubLoginUrl(currentPath())}>去登录</a>
              </p>
            )}

            {/* 评论区：grid-template-rows 0fr → 1fr 丝滑下拉 */}
            <div
              className={`essay-comments${showComments ? " is-open" : ""}`}
              aria-hidden={!showComments}
            >
              <div className="essay-comments__inner">
                {showComments && <Comments target="essay" targetId={essay.id} />}
              </div>
            </div>
          </div>
        )}
      </article>

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
