"use client";

import { useState } from "react";

import { initialOf, type FriendLink } from "@/lib/friendlinks";

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
  /** 是否是当前展开气泡的那张（用来加高亮） */
  active: boolean;
}

/**
 * 一张友链卡片：圆形（不是常规矩形卡片），权重越大直径越大、光晕越强。
 *
 * 交互（点击看详情 / 长按拖动）统一由父级 FriendsClient 在舞台层处理，
 * 因为卡片位置每帧在变、而且需要捕获指针；这里只负责画。
 */
export default function FriendCard({ link, visual, active }: Props) {
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
        // 用 CSS 变量把"强调程度"传给样式，避免一堆内联属性
        ["--fc-glow" as string]: glow,
        ["--fc-name-size" as string]: `${10 + visual.emphasis * 4}px`,
      }}
      role="button"
      tabIndex={0}
      aria-label={`${link.name}：点击查看详情，长按可拖动`}
      data-link-id={link.id}
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

      {/* 类型标签（有才显示） */}
      {link.category && <span className="fc-card__tag">{link.category}</span>}
    </div>
  );
}
