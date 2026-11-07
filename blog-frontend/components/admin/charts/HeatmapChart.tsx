"use client";

import { useMemo } from "react";

import type { HeatmapDay } from "@/lib/admin";

interface Props {
  data: HeatmapDay[];
  /** 单元格边长（px），默认 11 */
  cell?: number;
}

/**
 * 活动热力图（GitHub 贡献图那种）。
 *
 * 三件事值得说明：
 *
 * 1. **列是"周"，行是"星期"**
 *    7 行从周一排到周日（不是周日开头），符合国内看日历的习惯。
 *    第一周前面要补空格，让 1 月 1 日落在它真正的星期几上。
 *
 * 2. **等级只按"总活动量"算，明细放悬浮提示**
 *    浏览、发文、评论的量级差很多（浏览是几百，发文是个位数），
 *    如果按分项加权反而更难讲清楚。所以方块深浅只看总数，
 *    悬浮时才展开"浏览 / 内容 / 评论"三项。
 *
 * 3. **纯 div + CSS，不用 SVG 也不用图表库**
 *    一个格子就是一个 div，365 个 div 的渲染成本可以忽略，
 *    而且天然支持 focus（键盘 viewable）、reduced-motion。
 */
export default function HeatmapChart({ data, cell = 11 }: Props) {
  const { weeks, monthLabels, max, total } = useMemo(() => {
    const weekRows: (HeatmapDay | null)[][] = [];
    let current: (HeatmapDay | null)[] = [];

    // 第一天该落在第几行（周一=0，周日=6）
    if (data.length) {
      const first = new Date(`${data[0].date}T00:00:00Z`);
      const dow = (first.getUTCDay() + 6) % 7;
      for (let i = 0; i < dow; i += 1) current.push(null);
    }

    for (const day of data) {
      current.push(day);
      if (current.length === 7) {
        weekRows.push(current);
        current = [];
      }
    }
    if (current.length) {
      while (current.length < 7) current.push(null);
      weekRows.push(current);
    }

    // 月份标签：某一周的第一天进入新月份时打个标
    const labels: { col: number; label: string }[] = [];
    let lastMonth = "";
    weekRows.forEach((week, col) => {
      const firstReal = week.find((d) => d !== null);
      if (!firstReal) return;
      const d = new Date(`${firstReal.date}T00:00:00Z`);
      const m = `${d.getUTCMonth() + 1}月`;
      // 只在月份变化、且不贴着上一个月标时打（避免标签挤在一起）
      if (m !== lastMonth) {
        const prevCol = labels.length ? labels[labels.length - 1].col : -99;
        if (col - prevCol >= 3) {
          labels.push({ col, label: m });
          lastMonth = m;
        }
      }
    });

    const totals = data.map((d) => d.views + d.posts + d.comments);
    return {
      weeks: weekRows,
      monthLabels: labels,
      max: Math.max(1, ...totals),
      total: totals.reduce((a, b) => a + b, 0),
    };
  }, [data]);

  /** 0-4 等级：按当天总量相对最大值分档，至少 1 档只要大于 0 */
  const level = (d: HeatmapDay): number => {
    const t = d.views + d.posts + d.comments;
    if (t <= 0) return 0;
    const ratio = t / max;
    if (ratio > 0.75) return 4;
    if (ratio > 0.5) return 3;
    if (ratio > 0.25) return 2;
    return 1;
  };

  const DOW = ["一", "", "三", "", "五", "", "日"];

  return (
    <div className="heatmap">
      <div className="heatmap__scroll">
        <div className="heatmap__inner">
          {/* 月份标签 */}
          <div className="heatmap__months">
            {weeks.map((_, col) => {
              const hit = monthLabels.find((m) => m.col === col);
              return (
                <span
                  key={col}
                  className="heatmap__month"
                  style={{ width: cell + 3 }}
                >
                  {hit?.label ?? ""}
                </span>
              );
            })}
          </div>

          <div className="heatmap__body">
            {/* 左侧星期标签 */}
            <div className="heatmap__dow">
              {DOW.map((label, i) => (
                <span
                  key={i}
                  className="heatmap__dow-item"
                  style={{ height: cell + 3 }}
                >
                  {label}
                </span>
              ))}
            </div>

            {/* 格子 */}
            <div className="heatmap__grid">
              {weeks.map((week, col) => (
                <div key={col} className="heatmap__col">
                  {week.map((day, row) =>
                    day === null ? (
                      <span
                        key={row}
                        className="heatmap__cell is-empty"
                        style={{ width: cell, height: cell }}
                      />
                    ) : (
                      <span
                        key={row}
                        className="heatmap__cell"
                        data-level={level(day)}
                        style={{ width: cell, height: cell }}
                        tabIndex={0}
                        title={`${day.date}\n浏览 ${day.views} · 内容 ${day.posts} · 评论 ${day.comments}`}
                        aria-label={`${day.date}：浏览 ${day.views}，内容 ${day.posts}，评论 ${day.comments}`}
                      />
                    )
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="heatmap__foot">
        <span className="admin-muted text-xs">
          近一年共 {total} 次活动（浏览 + 内容 + 评论）
        </span>
        <span className="heatmap__legend" aria-hidden="true">
          <span className="heatmap__legend-text">少</span>
          {[0, 1, 2, 3, 4].map((l) => (
            <span
              key={l}
              className="heatmap__cell"
              data-level={l}
              style={{ width: cell, height: cell }}
            />
          ))}
          <span className="heatmap__legend-text">多</span>
        </span>
      </div>
    </div>
  );
}
