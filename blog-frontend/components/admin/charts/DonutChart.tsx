"use client";

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
 */
export default function DonutChart({ data, size = 200, thickness = 26 }: Props) {
  const total = data.reduce((n, d) => n + d.value, 0);
  const r = (size - thickness) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * r;

  let offset = 0;

  return (
    <div className="donut-wrap">
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
        {total === 0 ? (
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
          data.map((d, i) => {
            const frac = d.value / total;
            const len = frac * circumference;
            // 留 2px 间隙让相邻扇区有分隔感
            const gap = Math.min(2, len / 4);
            const seg = (
              <circle
                key={d.name}
                cx={cx}
                cy={cy}
                r={r}
                fill="none"
                stroke={PALETTE[i % PALETTE.length]}
                strokeWidth={thickness}
                strokeDasharray={`${Math.max(len - gap, 0.001)} ${circumference}`}
                strokeDashoffset={-offset}
                // 从 12 点方向开始
                transform={`rotate(-90 ${cx} ${cy})`}
                strokeLinecap="butt"
              />
            );
            offset += len;
            return seg;
          })
        )}
        {/* 中心文字：总数 */}
        <text
          x={cx}
          y={cy - 2}
          textAnchor="middle"
          className="donut-total"
        >
          {total}
        </text>
        <text x={cx} y={cy + 16} textAnchor="middle" className="donut-sub">
          总计
        </text>
      </svg>

      <ul className="donut-legend">
        {data.length === 0 ? (
          <li className="donut-legend__empty">暂无数据</li>
        ) : (
          data.map((d, i) => (
            <li key={d.name} className="donut-legend__item">
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
