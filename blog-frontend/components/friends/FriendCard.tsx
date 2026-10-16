"use client";

import { useState } from "react";

import { hostOf, initialOf, type FriendLink } from "@/lib/friendlinks";

/** 卡片在动画循环里由物理引擎驱动，这里只接收渲染所需的数据 */
export interface CardVisual {
  id: number;
  /** 直径（px） */
  size: number;
  /** 归一化权重 0..1，用于决定"强调程度" */
  emphasis: number;
}

interface Props {
  link: FriendLink;
  visual: CardVisual;
  /** 是否已展开气泡详情 */
  active: boolean;
  onToggle: () => void;
}

/**
 * 一张友链卡片：圆形（不是常规矩形卡片），权重越大直径越大、光晕越强。
 * 点击后在卡片旁边弹出气泡详情。
 */
export default function FriendCard({ link, visual, active, onToggle }: Props) {
  const [coverBroken, setCoverBroken] = useState(false);

  const size = visual.size;
  const showCover = !!link.cover && !coverBroken;
  // 权重越高：边框越亮、阴影越强
  const glow = 0.18 + visual.emphasis * 0.42;

  return (
    <div
      className={`fc-card${active ? " is-active" : ""}`}
      style={{
        width: size,
        height: size,
        // 用 CSS 变量把"强调程度"传给样式，避免写一堆内联属性
        ["--fc-glow" as string]: glow,
        ["--fc-name-size" as string]: `${10 + visual.emphasis * 4}px`,
      }}
    >
      <button
        type="button"
        className="fc-card__hit"
        onClick={onToggle}
        aria-label={`${link.name} 详情`}
        aria-expanded={active}
      >
        {showCover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={link.cover as string}
            alt=""
            className="fc-card__cover"
            onError={() => setCoverBroken(true)}
            draggable={false}
          />
        ) : (
          <span className="fc-card__initial">{initialOf(link.name)}</span>
        )}

        {/* 名称始终可读：压在底部，带渐变底衬 */}
        <span className="fc-card__name" title={link.name}>
          {link.name}
        </span>
      </button>

      {/* 类型标签（有才显示） */}
      {link.category && <span className="fc-card__tag">{link.category}</span>}

      {/* 气泡详情 */}
      {active && (
        <div className="fc-bubble" role="dialog" aria-label={`${link.name} 信息`}>
          <div className="fc-bubble__arrow" />
          <div className="fc-bubble__head">
            {showCover ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={link.cover as string} alt="" className="fc-bubble__avatar" />
            ) : (
              <span className="fc-bubble__avatar fc-bubble__avatar--fallback">
                {initialOf(link.name)}
              </span>
            )}
            <div className="fc-bubble__title-wrap">
              <div className="fc-bubble__title">{link.name}</div>
              <div className="fc-bubble__host">{hostOf(link.url)}</div>
            </div>
          </div>

          {link.description && (
            <p className="fc-bubble__desc">{link.description}</p>
          )}

          <div className="fc-bubble__foot">
            {link.category && (
              <span className="fc-bubble__tag">{link.category}</span>
            )}
            <a
              className="fc-bubble__visit"
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              访问站点 →
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
