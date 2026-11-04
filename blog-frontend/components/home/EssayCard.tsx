"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { MorphIcon } from "morphicons/react";
import {
  MessageSquare,
  Image as ImageIcon,
  Heart,
  ChevronRight,
} from "lucide";
import { api } from "@/lib/api";
import type { Essay } from "@/lib/types";
import { relativeTime } from "@/lib/format";
import { resolveImageUrl } from "@/lib/url";
import CardSkeleton from "./CardSkeleton";

const CARD_HEIGHT = 200;
/** 一次取多少条说说用于轮播 */
const FETCH_LIMIT = 8;

/**
 * 卡片本体（只有展示，不含轮播逻辑）。
 *
 * 抽出来是因为轮播需要同时存在两张：正在离开的和正在进入的。
 * 卡片自己保留原有的悬停效果（.essay-card:hover，见 home-cards.css），
 * 轮播的旋转发生在外层 .essay-switch__pane 上，两者互不覆盖。
 */
function EssayFace({
  essay,
  withSwitch,
}: {
  essay: Essay;
  withSwitch: boolean;
}) {
  const images = essay.images || [];

  return (
    <Link
      href="/essays"
      className={`essay-card glass${withSwitch ? " essay-card--has-switch" : ""}`}
      style={{ height: CARD_HEIGHT }}
    >
      {/* 星光装饰层 */}
      <div className="essay-card__stars-layer" aria-hidden="true">
        <div className="essay-card__stars essay-card__stars--1" />
        <div className="essay-card__stars essay-card__stars--2" />
      </div>

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
          {images.length > 0 && (
            <span className="essay-card__badge">
              <MorphIcon icon={ImageIcon} size={10} />
              {images.length}
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
                  <img src={resolveImageUrl(img)} alt="" loading="lazy" />
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

/**
 * 首页「说说」卡片，支持在多条说说之间切换。
 *
 * 切换动画：以卡片**左上角**为轴顺时针旋转，带多段回弹
 * （关键帧见 app/styles/essay-switch.css 的 essaySwingIn / essaySwingOut）。
 * 悬停效果由 .essay-card 自己负责，不受影响。
 */
export default function EssayCard() {
  const [items, setItems] = useState<Essay[]>([]);
  const [loading, setLoading] = useState(true);
  const [index, setIndex] = useState(0);
  // 每切换一次 +1：既作为动画重置的 key，也用来判断"有没有离开的卡片"
  const [step, setStep] = useState(0);
  const [leavingVisible, setLeavingVisible] = useState(false);

  useEffect(() => {
    api
      .get<Essay[]>(`/api/essays?limit=${FETCH_LIMIT}`)
      .then((list) => {
        if (list && list.length > 0) setItems(list);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const canSwitch = items.length > 1;

  const goNext = useCallback(() => {
    if (!canSwitch) return;
    setIndex((i) => (i + 1) % items.length);
    setStep((s) => s + 1);
    setLeavingVisible(true);
  }, [canSwitch, items.length]);

  // 只处理方向键：Enter/Space 浏览器本来就会触发 click，
  // 这里再拦一次会导致按一下就前进两条。
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!canSwitch) return;
    if (e.key === "ArrowRight") {
      e.preventDefault();
      goNext();
    }
  };

  if (loading && items.length === 0) {
    return (
      <div style={{ height: CARD_HEIGHT }}>
        <CardSkeleton lines={3} className="h-full" />
      </div>
    );
  }

  if (items.length === 0) {
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

  const current = items[index];
  // 离开的那张：step > 0 时才存在（首次加载没有"上一张"）
  const outgoing =
    step > 0 ? items[(index - 1 + items.length) % items.length] : null;

  return (
    <div className="essay-switch" style={{ height: CARD_HEIGHT }}>
      <div className="essay-switch__stage">
        {/* 正在离开（上层是进入的，所以它压在上面） */}
        {outgoing && leavingVisible && (
          <div
            key={`out-${step}`}
            className="essay-switch__pane is-leaving"
            aria-hidden="true"
            onAnimationEnd={(e) => {
              // animationend 会冒泡：只认自己这一层，别被卡内子动画提前触发
              if (e.target === e.currentTarget) setLeavingVisible(false);
            }}
          >
            <EssayFace essay={outgoing} withSwitch={canSwitch} />
          </div>
        )}

        {/* 当前这张：key 变化才会重放进入动画 */}
        <div
          key={`in-${step}`}
          className={`essay-switch__pane${step > 0 ? " is-entering" : ""}`}
        >
          <EssayFace essay={current} withSwitch={canSwitch} />
        </div>
      </div>

      {/* 切换瞬间的光扫 */}
      {step > 0 && (
        <span key={`flare-${step}`} className="essay-switch__flare" aria-hidden="true" />
      )}

      {/* 位置圆点已移除：右下角的计数已经表达了进度，
          而左下角会和卡片的缩略图重叠。 */}

      {/* 右下角：计数 + 换一条 */}
      {canSwitch && (
        <div className="essay-switch__nav">
          <span className="essay-switch__counter">
            {index + 1}/{items.length}
          </span>
          <button
            type="button"
            className="essay-switch__next"
            onClick={goNext}
            onKeyDown={onKeyDown}
            aria-label="换一条说说"
            title="换一条说说"
          >
            <MorphIcon icon={ChevronRight} size={12} />
          </button>
        </div>
      )}

      {/* 无障碍：切换后播报当前内容摘要 */}
      <span className="sr-only" aria-live="polite">
        {`第 ${index + 1} 条，共 ${items.length} 条：${
          current.content?.slice(0, 40) || current.title || ""
        }`}
      </span>
    </div>
  );
}
