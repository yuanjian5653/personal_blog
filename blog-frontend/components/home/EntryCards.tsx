"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { FolderKanban, Users, Wrench } from "lucide";
import { MorphIcon } from "morphicons/react";

import { cachedGet } from "@/lib/cache";

/** 三个入口的静态配置 */
const ENTRIES = [
  {
    key: "projects",
    name: "项目",
    desc: "我在 GitHub 上写的东西",
    href: "/projects",
    icon: FolderKanban,
    /** 与主题强调色混合出的低饱和小色，只用于光斑/图标/边框 */
    glow: "color-mix(in srgb, var(--accent) 68%, #4f9dff 32%)",
    unit: "个仓库",
  },
  {
    key: "tools",
    name: "工具",
    desc: "自用的小工具",
    href: "/tools",
    icon: Wrench,
    glow: "color-mix(in srgb, var(--accent) 62%, #ff8a5b 38%)",
    unit: null, // 工具没有接口，显示固定文案
  },
  {
    key: "friends",
    name: "友链",
    desc: "去看看我的朋友们",
    href: "/friends",
    icon: Users,
    glow: "color-mix(in srgb, var(--accent) 60%, #35d0a5 40%)",
    unit: "位朋友",
  },
] as const;

type Counts = { projects: number | null; friends: number | null };

/**
 * 首页底部三个入口卡片（项目 / 工具 / 友链）。
 *
 * 相比原来只有"标题 + 一行描述"的玻璃块，这里加了几层克制的效果：
 *   · 指针跟随光斑 —— 光斑位置写进 CSS 变量（--spot-x/--spot-y），
 *     用 setProperty 直接改样式，不触发 React 重渲染
 *   · 悬停时边框亮起当前卡片的量身色，并带一圈外发光
 *   · 图标从方形玻璃砖里浮起、轻微旋转
 *   · 右上角箭头右移、底部一次性光扫
 *   · 入场时三张卡错开 60ms 依次浮起
 *
 * 颜色全部来自站点卡片主题变量（--card-bg / --card-border / --card-text /
 * --card-shadow / --accent），所以调整明暗与强调色时会自动跟随；
 * 每张卡的 glow 只是"accent 混合一个固定色"，仍在同一色系里。
 *
 * 数量来自 /api/projects、/api/friend-links（都走 cachedGet，切页回来不重复请求）；
 * 接口失败就退回通用文案，不影响卡片本身。
 */
export default function EntryCards() {
  const [counts, setCounts] = useState<Counts>({ projects: null, friends: null });

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      cachedGet<unknown[]>("/api/projects", 60_000).catch(() => null),
      cachedGet<unknown[]>("/api/friend-links", 60_000).catch(() => null),
    ]).then(([projects, friends]) => {
      if (cancelled) return;
      setCounts({
        projects: Array.isArray(projects) ? projects.length : null,
        friends: Array.isArray(friends) ? friends.length : null,
      });
    });

    return () => {
      cancelled = true;
    };
  }, []);

  /** 指针移动：把光斑坐标写进 CSS 变量（不触发重渲染） */
  const handleMove = (e: React.PointerEvent<HTMLAnchorElement>) => {
    // 触屏没有"悬停"，直接跳过，避免点击后留下一个固定光斑
    if (e.pointerType !== "mouse") return;
    const el = e.currentTarget;
    const rect = el.getBoundingClientRect();
    el.style.setProperty("--spot-x", `${e.clientX - rect.left}px`);
    el.style.setProperty("--spot-y", `${e.clientY - rect.top}px`);
  };

  return (
    <div className="entry-grid">
      {ENTRIES.map((entry, i) => {
        const count =
          entry.key === "projects"
            ? counts.projects
            : entry.key === "friends"
              ? counts.friends
              : null;

        const meta =
          count !== null && entry.unit
            ? `${count} ${entry.unit}`
            : entry.unit
              ? "正在整理"
              : "持续施工中";

        return (
          <Link
            key={entry.key}
            href={entry.href}
            className="entry-card"
            style={
              {
                "--fc-glow": entry.glow,
                "--fc-i": i,
              } as React.CSSProperties
            }
            onPointerMove={handleMove}
          >
            {/* 指针跟随光斑 */}
            <span className="entry-card__wash" aria-hidden="true" />
            {/* 悬停时的一次性斜向光扫 */}
            <span className="entry-card__sheen" aria-hidden="true" />

            <span className="entry-card__icon" aria-hidden="true">
              <MorphIcon icon={entry.icon} size={18} />
            </span>

            <span className="entry-card__body">
              <span className="entry-card__title">{entry.name}</span>
              <span className="entry-card__desc">{entry.desc}</span>
            </span>

            {/* 右侧：数量 + 箭头（横向排布，所以卡片能压得比较矮） */}
            <span className="entry-card__side">
              <span className="entry-card__meta">{meta}</span>
              <span className="entry-card__arrow" aria-hidden="true">
                →
              </span>
            </span>
          </Link>
        );
      })}
    </div>
  );
}
