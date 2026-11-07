"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  BarChart3,
  Eye,
  FileText,
  FolderTree,
  Mail,
  MessageSquare,
  PenLine,
  Tags,
  type IconNode,
} from "lucide";
import { MorphIcon } from "morphicons/react";

import {
  fetchDashboardStats,
  type DashboardStats,
  type StatCard,
} from "@/lib/admin";
import AreaChart from "@/components/admin/charts/AreaChart";
import BarList from "@/components/admin/charts/BarList";
import DonutChart from "@/components/admin/charts/DonutChart";
import HeatmapChart from "@/components/admin/charts/HeatmapChart";
import HourBars from "@/components/admin/charts/HourBars";

/**
 * 卡片图标。
 * 用 lucide 图标（配合 MorphIcon 渲染），不再用 emoji ——
 * emoji 的字体、颜色和基线在各系统上都不一样，和侧边栏的图标风格也不统一。
 */
const CARD_ICONS: Record<string, IconNode> = {
  subscribers: Mail,
  published: FileText,
  drafts: PenLine,
  categories: FolderTree,
  tags: Tags,
  comments: MessageSquare,
  visitors: Eye,
};

/** 卡片点击后跳哪里（有对应管理页的才给链接） */
const CARD_LINKS: Record<string, string> = {
  subscribers: "/admin/subscribers",
  published: "/admin/posts",
  drafts: "/admin/posts",
  comments: "/admin/comments",
  tags: "/admin/posts",
  categories: "/admin/posts",
};

function StatCards({ cards }: { cards: StatCard[] }) {
  return (
    <div className="stat-cards">
      {cards.map((c) => {
        const href = CARD_LINKS[c.key];
        const inner = (
          <>
            <div className="stat-card__icon">
              <MorphIcon
                icon={CARD_ICONS[c.key] ?? BarChart3}
                size={19}
                strokeWidth={1.9}
              />
            </div>
            <div className="stat-card__body">
              <div className="stat-card__label">{c.label}</div>
              <div className="stat-card__value">{c.value}</div>
            </div>
          </>
        );
        return href ? (
          <Link key={c.key} href={href} className="stat-card">
            {inner}
          </Link>
        ) : (
          <div key={c.key} className="stat-card">
            {inner}
          </div>
        );
      })}
    </div>
  );
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchDashboardStats()
      .then((d) => {
        if (!cancelled) setStats(d);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "加载失败");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <div className="admin-panel">
        <p className="admin-error">看板加载失败：{error}</p>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="admin-panel">
        <p className="admin-muted">看板加载中…</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold">仪表盘</h1>
        <span className="admin-muted text-xs">
          趋势区间 {stats.range_start} ~ {stats.range_end}
        </span>
      </div>

      {/* 顶部统计卡片 */}
      <StatCards cards={stats.cards} />

      {/* 两张趋势图 */}
      <div className="chart-grid">
        <section className="admin-panel">
          <h2 className="admin-panel__title">文章发布趋势（近30天）</h2>
          <AreaChart data={stats.article_trend} color="#6366f1" />
        </section>

        <section className="admin-panel">
          <h2 className="admin-panel__title">访客趋势（近30天）</h2>
          <AreaChart data={stats.visitor_trend} color="#14b8a6" />
        </section>
      </div>

      {/* 活动热力图（近一年）—— 单独一行，格子需要横向空间 */}
      <section className="admin-panel">
        <h2 className="admin-panel__title">活动热力图（近一年）</h2>
        <HeatmapChart data={stats.heatmap} />
      </section>

      {/* 热门页面 + 访问时段 */}
      <div className="chart-grid">
        <section className="admin-panel">
          <h2 className="admin-panel__title">热门页面（近30天）</h2>
          <BarList data={stats.top_pages} color="#6366f1" />
        </section>

        <section className="admin-panel">
          <h2 className="admin-panel__title">访问时段分布（近30天）</h2>
          <HourBars data={stats.hour_distribution} color="#8b5cf6" />
        </section>
      </div>

      {/* 两张分布图 */}
      <div className="chart-grid">
        <section className="admin-panel">
          <h2 className="admin-panel__title">分类分布</h2>
          <DonutChart data={stats.category_distribution} />
        </section>

        <section className="admin-panel">
          <h2 className="admin-panel__title">浏览器分布</h2>
          <DonutChart data={stats.browser_distribution} />
        </section>
      </div>
    </div>
  );
}
