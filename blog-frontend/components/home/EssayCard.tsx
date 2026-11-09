"use client";

import AuthorChip from "@/components/AuthorChip";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { MorphIcon } from "morphicons/react";
import { MessageSquare, Image as ImageIcon, Heart, ChevronRight } from "lucide";
import { api } from "@/lib/api";
import type { Essay } from "@/lib/types";
import { relativeTime } from "@/lib/format";
import { resolveImageUrl } from "@/lib/url";
import CardSkeleton from "./CardSkeleton";

const CARD_HEIGHT = 200;
/** 一次取多少条说说用于轮播 */
const FETCH_LIMIT = 8;

/**
 * 卡片外观（只有展示，不含轮播逻辑）。
 *
 * 为什么卡片是 <div> 而不是 <a>：
 *   切换按钮必须能"跟着卡片"——既跟着轮播的旋转，也跟着悬停时的斜飞。
 *   要做到这点，按钮必须是卡片的子元素。而 <button> 嵌在 <a> 里是无效 HTML
 *   （交互元素不能嵌套），所以卡片改成 <div>，再用一个铺满的
 *   <Link class="essay-card__hit"> 承担整卡点击。
 *   悬停效果仍是 .essay-card:hover（见 home-cards.css），未做改动。
 */
function EssayFace({
  essay,
  controls,
}: {
  essay: Essay;
  controls?: React.ReactNode;
}) {
  const images = essay.images || [];

  return (
    <div
      className={`essay-card glass${controls ? " essay-card--has-switch" : ""}`}
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
            <AuthorChip authorId={essay.author_id} />
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

      {/* 整卡点击层：放在内容之上（z-index 2），按钮之下（z-index 3） */}
      <Link
        href="/essays"
        className="essay-card__hit"
        aria-label="查看全部说说"
      />

      {/* 切换控件：作为卡片子元素，跟随旋转与悬停 */}
      {controls}
    </div>
  );
}

/**
 * 首页「说说」卡片，支持在多条说说之间切换。
 *
 * 切换动画：以卡片**左上角**为轴顺时针旋转，带多段回弹
 * （关键帧见 app/styles/essay-switch.css 的 essaySwingIn / essaySwingOut）。
 * 切换按钮在卡片内部，所以会跟着卡片一起转。
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
      .get<Essay[]>(`/api/essays?limit=${FETCH_LIMIT}&visitor=1`)
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
      <div className="essay-card glass" style={{ height: CARD_HEIGHT }}>
        <div className="essay-card__content">
          <div className="essay-card__head">
            <span className="essay-card__tag">说说</span>
          </div>
          <p className="essay-card__text">还没有说说</p>
        </div>
        <Link href="/essays" className="essay-card__hit" aria-label="查看全部说说" />
      </div>
    );
  }

  const current = items[index];
  // 离开的那张：step > 0 时才存在（首次加载没有"上一张"）
  const outgoing =
    step > 0 ? items[(index - 1 + items.length) % items.length] : null;

  const controls = canSwitch ? (
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
  ) : null;

  return (
    <div className="essay-switch" style={{ height: CARD_HEIGHT }}>
      <div className="essay-switch__stage">
        {/* 正在离开的卡片（不带控件，避免出现两个按钮） */}
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
            <EssayFace essay={outgoing} />
          </div>
        )}

        {/* 当前这张：key 变化才会重放进入动画 */}
        <div
          key={`in-${step}`}
          className={`essay-switch__pane${step > 0 ? " is-entering" : ""}`}
        >
          <EssayFace essay={current} controls={controls} />
        </div>
      </div>

      {/* 切换瞬间的光扫 */}
      {step > 0 && (
        <span
          key={`flare-${step}`}
          className="essay-switch__flare"
          aria-hidden="true"
        />
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
