"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import type { ArticleListItem } from "@/lib/types";
import { resolveImageUrl } from "@/lib/url";
import { parseTags } from "@/lib/tags";

export default function ArticleCard({ height = 220 }: { height?: number }) {
  const [articles, setArticles] = useState<ArticleListItem[]>([]);
  const [index, setIndex] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [loading, setLoading] = useState(true);
  // 用于强制重播动画
  const [animKey, setAnimKey] = useState(0);

  // 加载文章列表
  useEffect(() => {
    api
      .get<ArticleListItem[]>("/api/articles")
      .then((list) => setArticles(list))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // 自动循环（悬浮时暂停）
  useEffect(() => {
    if (articles.length <= 1 || hovered) return;
    const timer = setInterval(() => {
      setIndex((i) => (i + 1) % articles.length);
      // 每次切歌都让 animKey 变化，触发动画重新播放
      setAnimKey((k) => k + 1);
    }, 4500);
    return () => clearInterval(timer);
  }, [articles.length, hovered]);

  if (loading || articles.length === 0) {
    return (
      <div className="glass p-5 flex flex-col justify-end" style={{ height }}>
        <h2 className="text-base font-semibold mb-1">文章</h2>
        <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
          {loading ? "加载中..." : "还没有文章"}
        </p>
      </div>
    );
  }

  const article = articles[index];
  const coverUrl = resolveImageUrl(article.cover_path);

  return (
    <Link
      href={`/articles/${article.slug}`}
      className="article-flip-card"
      style={{ height }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* 正面：封面 + 遮罩 + 标题/简介/标签（hover 时整体下移淡出） */}
      <div className="article-flip-card__front">
        {/* 背景封面：key 变化触发滑入回弹动画 */}
        <div
          key={animKey}
          className="article-flip-card__bg-img"
          style={{
            backgroundImage: coverUrl ? `url(${coverUrl})` : "none",
          }}
        />

        {/* 底部渐变遮罩 */}
        <div className="article-flip-card__overlay" />

        {/* 默认状态：底部显示标题 + 简介 + 标签 */}
        <div key={`info-${animKey}`} className="article-flip-card__default">
          <h2 className="article-flip-card__default-title">{article.title}</h2>
          <p className="article-flip-card__default-desc">
            {article.excerpt || ""}
          </p>
          {/* 标签 */}
          {article.tags && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {parseTags(article.tags, 3).map((tag) => (
                <span
                  key={tag}
                  className="text-[10px] px-1.5 py-0.5 rounded"
                  style={{
                    background: "rgba(124, 92, 255, 0.4)",
                    color: "#fff",
                  }}
                >
                  #{tag}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 详情层：默认藏在视口上方，hover 时滑下来 */}
      <div className="article-flip-card__content">
        <div className="article-flip-card__content-inner">
          <h2 className="article-flip-card__title">{article.title}</h2>
          <p className="article-flip-card__desc">
            {article.excerpt || "点击查看完整文章"}
          </p>
          {/* 标签 */}
          {article.tags && (
            <div className="flex flex-wrap gap-1">
              {parseTags(article.tags).map((tag) => (
                <span key={tag} className="article-flip-card__tag">
                  #{tag}
                </span>
              ))}
            </div>
          )}
          <span className="article-flip-card__more">阅读全文 →</span>
        </div>
      </div>
    </Link>
  );
}