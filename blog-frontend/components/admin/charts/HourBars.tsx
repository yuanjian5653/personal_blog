"use client";

import type { HourPoint } from "@/lib/admin";

interface Props {
  data: HourPoint[];
  color?: string;
  height?: number;
}

/**
 * 24 小时访问分布（竖柱）。
 *
 * 用柱状而不是折线：小时是离散的 24 个桶，柱状更能表达"哪个时段有人"。
 * 峰值柱高亮，其余半透明 —— 一眼就能看出活跃时段。
 */
export default function HourBars({
  data,
  color = "#8b5cf6",
  height = 120,
}: Props) {
  if (data.length === 0) {
    return <p className="admin-muted text-xs">还没有访问数据。</p>;
  }

  const max = Math.max(1, ...data.map((d) => d.value));
  const total = data.reduce((a, b) => a + b.value, 0);

  return (
    <div className="hourbars">
      <div className="hourbars__plot" style={{ height }}>
        {data.map((d) => {
          const h = Math.max(2, (d.value / max) * 100);
          const isPeak = d.value === max && max > 0;
          return (
            <span
              key={d.hour}
              className={`hourbars__bar${isPeak ? " is-peak" : ""}`}
              style={{
                height: `${h}%`,
                background: color,
                opacity: d.value === 0 ? 0.12 : isPeak ? 1 : 0.5,
              }}
              title={`${String(d.hour).padStart(2, "0")}:00 · ${d.value} 次`}
              aria-label={`${d.hour} 点：${d.value} 次访问`}
            />
          );
        })}
      </div>

      <div className="hourbars__axis" aria-hidden="true">
        {data.map((d) =>
          d.hour % 6 === 0 ? (
            <span key={d.hour} className="hourbars__tick">
              {String(d.hour).padStart(2, "0")}
            </span>
          ) : (
            <span key={d.hour} className="hourbars__tick" />
          )
        )}
      </div>

      <p className="admin-muted text-xs" style={{ marginTop: 6 }}>
        共 {total} 次访问（北京时间）
      </p>
    </div>
  );
}
