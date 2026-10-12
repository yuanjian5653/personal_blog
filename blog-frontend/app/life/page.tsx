"use client";

import { useEffect, useState } from "react";
import { MorphIcon } from "morphicons/react";
import { Coffee, Search, ArrowDownWideNarrow, ArrowUpNarrowWide } from "lucide";
import { api } from "@/lib/api";
import type { LifePost } from "@/lib/types";
import LifeCard from "@/components/life/LifeCard";
import LifeDetail from "@/components/life/LifeDetail";

type SortMode = "newest" | "oldest";

export default function LifePage() {
  const [posts, setPosts] = useState<LifePost[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState("");
  const [sort, setSort] = useState<SortMode>("newest");
  const [selected, setSelected] = useState<LifePost | null>(null);
  const [siteConfig, setSiteConfig] = useState<Record<string, string>>({});

  // 加载动态
  useEffect(() => {
    api
      .get<LifePost[]>("/api/life")
      .then(setPosts)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // 加载作者信息
  useEffect(() => {
    api
      .get<{ configs: Record<string, string> }>("/api/site-config")
      .then((d) => setSiteConfig(d.configs || {}))
      .catch(() => {});
  }, []);

  // 筛选 + 排序
  const filtered = posts
    .filter((p) => {
      if (!keyword.trim()) return true;
      const kw = keyword.toLowerCase();
      return (
        (p.content || "").toLowerCase().includes(kw) ||
        (p.location || "").toLowerCase().includes(kw)
      );
    })
    .sort((a, b) => {
      const ta = new Date(a.created_at).getTime();
      const tb = new Date(b.created_at).getTime();
      return sort === "newest" ? tb - ta : ta - tb;
    });

  const authorName = siteConfig.author_name || "博主";
  const authorAvatar = siteConfig.author_avatar || "";

  return (
    <div className="max-w-4xl mx-auto pt-2">
      {/* Hero */}
      <div className="archive-hero">
        <h1 className="archive-hero-title">生活动态</h1>
        <p className="archive-hero-sub">
          <MorphIcon
            icon={Coffee}
            size={13}
            style={{ color: "var(--accent)" }}
          />
          记录生活的每一个瞬间
        </p>

        <div className="archive-search">
          <MorphIcon
            icon={Search}
            size={16}
            style={{ color: "var(--text-secondary)", flexShrink: 0 }}
          />
          <input
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索被遗忘的记忆..."
          />
          {keyword && (
            <button
              onClick={() => setKeyword("")}
              className="text-xs"
              style={{ color: "var(--text-secondary)" }}
            >
              ×
            </button>
          )}
        </div>
      </div>

      {/* 排序切换 */}
      <div className="flex justify-center mt-4 mb-8">
        <div className="view-switch">
          <button
            className={`view-switch-btn ${sort === "newest" ? "active" : ""}`}
            onClick={() => setSort("newest")}
          >
            <MorphIcon icon={ArrowDownWideNarrow} size={13} />
            <span>最新</span>
          </button>
          <button
            className={`view-switch-btn ${sort === "oldest" ? "active" : ""}`}
            onClick={() => setSort("oldest")}
          >
            <MorphIcon icon={ArrowUpNarrowWide} size={13} />
            <span>最早</span>
          </button>
        </div>
      </div>

      {/* 内容 */}
      {loading ? (
        <div className="archive-empty">加载中...</div>
      ) : filtered.length === 0 ? (
        <div className="archive-empty">
          {keyword ? "没有匹配的动态" : "还没有动态"}
        </div>
      ) : (
        <div className="life-grid">
          {filtered.map((p, i) => (
            <LifeCard
              key={p.id}
              post={p}
              index={i}
              onClick={() => setSelected(p)}
              authorName={authorName}
              authorAvatar={authorAvatar}
            />
          ))}
        </div>
      )}

      {/* 详情面板 */}
      {selected && (
        <LifeDetail
          post={selected}
          authorName={authorName}
          authorAvatar={authorAvatar}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}