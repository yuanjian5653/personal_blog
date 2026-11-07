"use client";

import type { PageStat } from "@/lib/admin";

interface Props {
  data: PageStat[];
  /** 条形的颜色 */
  color?: string;
}

/**
 * 横向条形排行（热门页面用）。
 *
 * 为什么不是饼图/环形图：页面访问量分布通常长尾且悬殊，
 * 环形图里小的那几块根本点不到；条形图横向排列反而更好比较。
 *
 * 路径太长时中间省略（保留开头和结尾），否则 /articles/xxx-yyy-zzz
 * 这种会被截得看不出是哪篇。
 */
function shortenPath(path: string, max = 34): string {
  if (path.length <= max) return path;
  const head = Math.ceil((max - 1) / 2);
  const tail = Math.floor((max - 1) / 2);
  return `${path.slice(0, head)}…${path.slice(-tail)}`;
}

export default function BarList({ data, color = "#6366f1" }: Props) {
  if (data.length === 0) {
    return <p className="admin-muted text-xs">还没有访问数据。</p>;
  }

  const max = Math.max(1, ...data.map((d) => d.value));

  return (
    <ul className="barlist">
      {data.map((row) => (
        <li key={row.path} className="barlist__row">
          <span className="barlist__label" title={row.path}>
            {shortenPath(row.path)}
          </span>
          <span className="barlist__track">
            <span
              className="barlist__bar"
              style={{
                width: `${Math.max(3, (row.value / max) * 100)}%`,
                background: color,
              }}
            />
          </span>
          <span className="barlist__value">{row.value}</span>
        </li>
      ))}
    </ul>
  );
}
