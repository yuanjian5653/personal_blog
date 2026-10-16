"use client";

import { useState } from "react";

import type { DistributionSlice } from "@/lib/admin";

interface Props {
  data: DistributionSlice[];
  size?: number;
  /** 环的粗细 */
  thickness?: number;
}

/** 一组分类色（按顺序循环使用） */
const PALETTE = [
  "#4f6ef7",
  "#a3d139",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#14b8a6",
  "#ec4899",
  "#64748b",
];

/**
 * 环形图（纯 SVG，无第三方依赖）。
 *
 * 用 stroke-dasharray 画弧比手算 path 更简单也更不容易出错：
 * 每个扇区就是一段虚线，长度 = 占比 × 周长。
 *
 * 交互（鼠标）：
 * - 悬停扇区或图例项 → 该扇区**加粗放大**、其余变淡，中心显示它的名称/数量/占比
 * - 移开 → 恢复显示总计
 * - 支持键盘：扇区可 Tab 聚焦，焦点等同悬停
 *
 * 交互状态用 selected 保存"当前高亮的索引"，扇区与图例共享同一个索引，
 * 所以鼠标放哪边都能联动。
 */
export default function DonutChart({ data, size = 200, thickness = 26 }: Props) {
  const [active, setActive] = useState<number | null>(null);

  const total = data.reduce((n, d) => n + d.value, 0);
  const r = (size - thickness) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * r;

  /** 悬停时环加粗一点，"被选中"的感觉更明显 */
  const activeThickness = thickness + 6;
  const current = active !== null ? data[active] : null;

  // 提前算好每段的起点偏移（渲染时还要用来叠加，所以先算一遍）
  const segments: Array<{
    name: string;
    value: number;
    color: string;
    len: number;
    offset: number;
  }> = [];
  let running = 0;
  data.forEach((d, i) => {
    const len = (d.value / total) * circumference;
    segments.push({
      name: d.name,
      value: d.value,
      color: PALETTE[i % PALETTE.length],
      len,
      offset: running,
    });
    running += len;
  });

  const empty = total === 0;

  return (
    <div className="donut-wrap">
      <div className="donut-svg-wrap" style={{ width: size, height: size }}>
        <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
          {empty ? (
            // 没有数据时画一个灰色空环，避免出现空白方块
            <circle
              cx={cx}
              cy={cy}
              r={r}
              fill="none"
              stroke="currentColor"
              strokeOpacity="0.12"
              strokeWidth={thickness}
            />
          ) : (
            segments.map((s, i) => {
              const isActive = active === i;
              const isDimmed = active !== null && !isActive;
              // 留 2px 间隙让相邻扇区有分隔感
              const gap = Math.min(2, s.len / 4);
              return (
                <circle
                  key={s.name}
                  cx={cx}
                  cy={cy}
                  r={r}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={isActive ? activeThickness : thickness}
                  strokeDasharray={`${Math.max(s.len - gap, 0.001)} ${circumference}`}
                  strokeDashoffset={-s.offset}
                  // 从 12 点方向开始
                  transform={`rotate(-90 ${cx} ${cy})`}
                  strokeLinecap="butt"
                  className={`donut-seg${isActive ? " is-active" : ""}${
                    isDimmed ? " is-dimmed" : ""
                  }`}
                  // 鼠标
                  onMouseEnter={() => setActive(i)}
                  onMouseLeave={() => setActive(null)}
                  // 键盘：可聚焦 + 回车/空格也算选中
                  tabIndex={0}
                  role="button"
                  aria-label={`${s.name}：${s.value}，占 ${Math.round(
                    (s.value / total) * 100
                  )}%`}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(null)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setActive(i);
                    }
                  }}
                />
              );
            })
          )}
        </svg>

        {/* 中心文字：默认显示总计，悬停某段时显示该段 */}
        <div className="donut-center">
          {current ? (
            <>
              <span className="donut-total">{current.value}</span>
              <span className="donut-center__name" title={current.name}>
                {current.name}
              </span>
              <span className="donut-sub">
                {Math.round((current.value / total) * 100)}%
              </span>
            </>
          ) : (
            <>
              <span className="donut-total">{total}</span>
              <span className="donut-sub">总计</span>
            </>
          )}
        </div>
      </div>

      <ul className="donut-legend">
        {data.length === 0 ? (
          <li className="donut-legend__empty">暂无数据</li>
        ) : (
          data.map((d, i) => (
            <li
              key={d.name}
              className={`donut-legend__item${
                active === i ? " is-active" : ""
              }${active !== null && active !== i ? " is-dimmed" : ""}`}
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive(null)}
            >
              <span
                className="donut-legend__dot"
                style={{ background: PALETTE[i % PALETTE.length] }}
              />
              <span className="donut-legend__name" title={d.name}>
                {d.name}
              </span>
              <span className="donut-legend__value">
                {d.value}
                {total > 0 && (
                  <span className="donut-legend__pct">
                    {Math.round((d.value / total) * 100)}%
                  </span>
                )}
              </span>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
