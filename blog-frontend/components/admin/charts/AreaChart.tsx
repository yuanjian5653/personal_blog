"use client";

import { useId, useMemo, useState } from "react";

import type { TrendPoint } from "@/lib/admin";

interface Props {
  data: TrendPoint[];
  /** 折线与填充的颜色 */
  color?: string;
  height?: number;
}

/**
 * 面积折线图（纯 SVG，无第三方依赖）。
 *
 * 为什么手写而不用 recharts 之类：
 * 这个项目只需要"一条平滑曲线 + 渐变填充 + 悬浮提示"，
 * 引一个图表库要多几百 KB，而且 SSR 下还要额外处理。
 */
export default function AreaChart({ data, color = "#6366f1", height = 220 }: Props) {
  // useId 让每个实例的渐变 id 唯一，避免同页多个图表互相覆盖
  const gradId = useId().replace(/:/g, "");
  const [hover, setHover] = useState<number | null>(null);

  const W = 640;
  const H = height;
  const padL = 34;
  const padR = 12;
  const padT = 14;
  const padB = 26;

  const { points, areaPath, linePath, maxV, ticks } = useMemo(() => {
    const n = Math.max(data.length, 2);
    const innerW = W - padL - padR;
    const innerH = H - padT - padB;

    // 纵轴上限：取最大值向上取整，且至少为 1，避免全 0 时除以 0
    const rawMax = Math.max(1, ...data.map((d) => d.value));
    const step = rawMax <= 5 ? 1 : Math.ceil(rawMax / 4);
    const maxV = Math.max(step * 4, rawMax);

    const x = (i: number) => padL + (innerW * i) / (n - 1);
    const y = (v: number) => padT + innerH - (innerH * v) / maxV;

    const pts = data.map((d, i) => ({ x: x(i), y: y(d.value), ...d }));

    // 用三次贝塞尔把折线画平滑（水平方向控制点取中点）
    let line = "";
    pts.forEach((p, i) => {
      if (i === 0) {
        line += `M ${p.x} ${p.y}`;
      } else {
        const prev = pts[i - 1];
        const cx = (prev.x + p.x) / 2;
        line += ` C ${cx} ${prev.y} ${cx} ${p.y} ${p.x} ${p.y}`;
      }
    });

    const area =
      pts.length > 0
        ? `${line} L ${pts[pts.length - 1].x} ${padT + innerH} L ${pts[0].x} ${padT + innerH} Z`
        : "";

    const tickVals = Array.from({ length: 5 }, (_, i) => (maxV / 4) * i);

    return { points: pts, areaPath: area, linePath: line, maxV, ticks: tickVals };
  }, [data, H]);

  // 横轴只显示约 6 个日期，避免挤在一起
  const labelEvery = Math.max(1, Math.ceil(data.length / 6));

  return (
    <div className="chart-wrap">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="chart-svg"
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={`g${gradId}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.38" />
            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {/* 横向网格 + 纵轴刻度 */}
        {ticks.map((t, i) => {
          const y = padT + (H - padT - padB) * (1 - t / maxV);
          return (
            <g key={i}>
              <line
                x1={padL}
                y1={y}
                x2={W - padR}
                y2={y}
                stroke="currentColor"
                strokeOpacity="0.1"
                strokeWidth="1"
              />
              <text
                x={padL - 8}
                y={y + 4}
                textAnchor="end"
                className="chart-tick"
              >
                {Math.round(t)}
              </text>
            </g>
          );
        })}

        {/* 面积 + 折线 */}
        {areaPath && <path d={areaPath} fill={`url(#g${gradId})`} />}
        {linePath && (
          <path
            d={linePath}
            fill="none"
            stroke={color}
            strokeWidth="2"
            strokeLinecap="round"
          />
        )}

        {/* 悬浮指示 */}
        {hover !== null && points[hover] && (
          <g>
            <line
              x1={points[hover].x}
              y1={padT}
              x2={points[hover].x}
              y2={H - padB}
              stroke={color}
              strokeOpacity="0.4"
              strokeDasharray="3 3"
            />
            <circle
              cx={points[hover].x}
              cy={points[hover].y}
              r="4"
              fill={color}
              /* 圆点描边用面板底色变量：后台是白底，写死 #fff 在白底上会看不见 */
              stroke="var(--adm-surface, #fff)"
              strokeWidth="2"
            />
          </g>
        )}

        {/* 横轴日期 */}
        {points.map((p, i) =>
          i % labelEvery === 0 ? (
            <text
              key={i}
              x={p.x}
              y={H - 8}
              textAnchor="middle"
              className="chart-tick"
            >
              {p.date}
            </text>
          ) : null
        )}

        {/* 透明热区：让鼠标更容易命中 */}
        {points.map((p, i) => {
          const w = (W - padL - padR) / Math.max(points.length - 1, 1);
          return (
            <rect
              key={i}
              x={p.x - w / 2}
              y={padT}
              width={Math.max(w, 6)}
              height={H - padT - padB}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
            />
          );
        })}
      </svg>

      {hover !== null && points[hover] && (
        <div className="chart-tip">
          {points[hover].date} · <b>{points[hover].value}</b>
        </div>
      )}
    </div>
  );
}
