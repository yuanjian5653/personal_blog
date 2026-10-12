"use client";

import {Suspense, useMemo, useState} from "react";
import {usePathname, useRouter, useSearchParams} from "next/navigation";
import Link from "next/link";
import {api} from "@/lib/api";
import type {ArticleListItem} from "@/lib/types";
import {useCachedFetch} from "@/lib/useCachedFetch";
import {formatDateShort} from "@/lib/format";
import {parseTags} from "@/lib/tags";
import {resolveImageUrl} from "@/lib/url";
import {MorphIcon} from "morphicons/react";
import {FileText} from "lucide";

type ViewMode = "timeline" | "grid";

interface YearGroup {
    year: number;
    items: ArticleListItem[];
}

function ArticlesContent() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const pathname = usePathname();

    const urlTag = searchParams.get("tag") || "";
    const urlView = searchParams.get("view");

    // 视图模式与标签筛选都以 URL 为唯一来源，因此不需要"状态 + 同步 effect"，
    // 顺带也带来了好处：链接可分享、浏览器前进后退能正确还原。
    const viewMode: ViewMode = urlView === "timeline" ? "timeline" : "grid";
    const activeTags = useMemo(() => (urlTag ? [urlTag] : []), [urlTag]);

    const [keyword, setKeyword] = useState("");
    const [activeCategory, setActiveCategory] = useState("");

    /** 改 URL 查询串（不产生历史记录） */
    const updateParams = (mutate: (p: URLSearchParams) => void) => {
        const params = new URLSearchParams(searchParams.toString());
        mutate(params);
        const qs = params.toString();
        router.replace(`${pathname}${qs ? "?" + qs : ""}`, {scroll: false});
    };

    const switchView = (mode: ViewMode) => {
        // grid 是默认，不带参数
        updateParams((p) => (mode === "grid" ? p.delete("view") : p.set("view", mode)));
    };

    const toggleTag = (name: string) => {
        updateParams((p) => (p.get("tag") === name ? p.delete("tag") : p.set("tag", name)));
    };

    const {data: articles, loading} = useCachedFetch<ArticleListItem[]>(
        "all_articles_archive",
        () => api.get<ArticleListItem[]>("/api/articles?limit=500"),
        60 * 1000
    );

    // 分类统计
    const categories = useMemo(() => {
        if (!articles) return [];
        const map = new Map<string, number>();
        for (const a of articles) {
            if (a.category) map.set(a.category, (map.get(a.category) || 0) + 1);
        }
        return Array.from(map.entries())
            .sort((a, b) => b[1] - a[1])
            .map(([name, count]) => ({name, count}));
    }, [articles]);

    // 标签统计
    const allTags = useMemo(() => {
        if (!articles) return [];
        const map = new Map<string, number>();
        for (const a of articles) {
            if (!a.tags) continue;
            for (const tag of parseTags(a.tags)) {
                map.set(tag, (map.get(tag) || 0) + 1);
            }
        }
        return Array.from(map.entries())
            .sort((a, b) => b[1] - a[1])
            .map(([name, count]) => ({name, count}));
    }, [articles]);

    // 筛选
    const filtered = useMemo(() => {
        if (!articles) return [];
        return articles.filter((a) => {
            if (activeCategory && a.category !== activeCategory) return false;
            if (activeTags.length > 0) {
                const at = parseTags(a.tags);
                for (const t of activeTags) {
                    if (!at.includes(t)) return false;
                }
            }
            if (keyword.trim()) {
                const kw = keyword.trim().toLowerCase();
                const title = (a.title || "").toLowerCase();
                const excerpt = (a.excerpt || "").toLowerCase();
                if (!title.includes(kw) && !excerpt.includes(kw)) return false;
            }
            return true;
        });
    }, [articles, activeCategory, activeTags, keyword]);

    // 按年分组（时间流用）
    const grouped = useMemo<YearGroup[]>(() => {
        const yearMap = new Map<number, ArticleListItem[]>();
        for (const a of filtered) {
            const year = new Date(a.created_at).getFullYear();
            if (!yearMap.has(year)) yearMap.set(year, []);
            yearMap.get(year)!.push(a);
        }
        return Array.from(yearMap.entries())
            .sort((a, b) => b[0] - a[0])
            .map(([year, items]) => ({
                year,
                items: items.sort(
                    (a, b) =>
                        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
                ),
            }));
    }, [filtered]);

    const clearAll = () => {
        setKeyword("");
        setActiveCategory("");
        updateParams((p) => p.delete("tag"));
    };

    const hasFilter =
        activeCategory || activeTags.length > 0 || keyword.trim();

    const totalArticles = articles?.length || 0;

    // 全局行索引（用于时间流入场错落）
    let globalRowIndex = 0;

    return (
        <div className="max-w-4xl mx-auto pt-2">
            {/* Hero */}
            <div className="archive-hero">
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 12,
                        marginBottom: 10,
                    }}
                >
                    <MorphIcon
                        icon={FileText}
                        size={28}
                        style={{color: "var(--accent)"}}
                    />
                    <h1 className="archive-hero-title" style={{margin: 0}}>
                        文章归档
                    </h1>
                </div>
                <p className="archive-hero-sub">
                    <span className="archive-hero-sub-icon">✦</span>
                    总计 {totalArticles} 篇研究记录
                    {hasFilter && ` · 筛选出 ${filtered.length} 篇`}
                </p>

                <div className="archive-search ">
                    <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                    >
                        <circle cx="11" cy="11" r="8"/>
                        <path d="m21 21-4.35-4.35"/>
                    </svg>
                    <input
                        type="text"
                        value={keyword}
                        onChange={(e) => setKeyword(e.target.value)}
                        placeholder="搜索标题或摘要..."
                    />
                    {keyword && (
                        <button
                            onClick={() => setKeyword("")}
                            className="text-xs"
                            style={{color: "var(--text-secondary)"}}
                        >
                            ×
                        </button>
                    )}
                </div>
            </div>

            {/* 筛选 + 视图切换 */}
            <div className="archive-controls">
                <div className="archive-filters">
                    <div
                        className={`archive-chip ${!hasFilter ? "active" : ""}`}
                        onClick={clearAll}
                    >
                        全部档案
                        <span className="archive-chip-count">{totalArticles}</span>
                    </div>

                    {categories.map((c) => (
                        <div
                            key={`cat-${c.name}`}
                            className={`archive-chip ${
                                activeCategory === c.name ? "active" : ""
                            }`}
                            onClick={() =>
                                setActiveCategory(activeCategory === c.name ? "" : c.name)
                            }
                        >
                            {c.name}
                            <span className="archive-chip-count">{c.count}</span>
                        </div>
                    ))}

                    {allTags.map((t) => (
                        <div
                            key={`tag-${t.name}`}
                            className={`archive-chip ${
                                activeTags.includes(t.name) ? "active" : ""
                            }`}
                            onClick={() => toggleTag(t.name)}
                        >
                            {t.name}
                            <span className="archive-chip-count">{t.count}</span>
                        </div>
                    ))}
                </div>

                <div className="view-switch">
                    <button
                        className={`view-switch-btn ${
                            viewMode === "grid" ? "active" : ""
                        }`}
                        onClick={() => switchView("grid")}
                        title="网格"
                    >
                        <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                        >
                            <rect x="3" y="3" width="7" height="7"/>
                            <rect x="14" y="3" width="7" height="7"/>
                            <rect x="3" y="14" width="7" height="7"/>
                            <rect x="14" y="14" width="7" height="7"/>
                        </svg>
                        <span>网格</span>
                    </button>
                    <button
                        className={`view-switch-btn ${
                            viewMode === "timeline" ? "active" : ""
                        }`}
                        onClick={() => switchView("timeline")}
                        title="时间流"
                    >
                        <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                        >
                            <path d="M3 6h18M3 12h18M3 18h18"/>
                        </svg>
                        <span>时间流</span>
                    </button>
                </div>
            </div>

            {/* 内容 */}
            {loading && !articles ? (
                <div className="archive-empty">加载中...</div>
            ) : filtered.length === 0 ? (
                <div className="archive-empty">
                    {hasFilter ? "没有符合条件的记录" : "还没有文章"}
                </div>
            ) : viewMode === "timeline" ? (
                /* ============ 时间流视图 ============ */
                <div className="tl-wrap">
                    <div className="tl-line"/>
                    {grouped.map((yearGroup) => (
                        <div key={yearGroup.year}>
                            <div className="tl-year">
                                <div className="tl-year-node"/>
                                <div className="tl-year-label">
                                    {yearGroup.year}
                                    <span className="tl-year-count">
                    {yearGroup.items.length} 篇
                  </span>
                                </div>
                            </div>

                            {yearGroup.items.map((a) => {
                                const idx = globalRowIndex++;
                                const isLeft = idx % 2 === 0;
                                return (
                                    <div
                                        key={a.id}
                                        className={`tl-row ${isLeft ? "left" : "right"}`}
                                        style={{
                                            animationDelay: `${Math.min(idx, 20) * 60}ms`,
                                        }}
                                    >
                                        <div className="tl-node"/>
                                        <ArticleCard article={a}/>
                                    </div>
                                );
                            })}
                        </div>
                    ))}
                </div>
            ) : (
                /* ============ 网格视图 ============ */
                <div className="tl-grid">
                    {filtered.map((a, i) => (
                        <div
                            key={a.id}
                            className="tl-grid-item"
                            style={{
                                animationDelay: `${Math.min(i, 20) * 50}ms`,
                            }}
                        >
                            <ArticleCard article={a}/>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

/** 文章卡片（时间流和网格共用） */
function ArticleCard({article: a}: { article: ArticleListItem }) {
    return (
        <Link href={`/articles/${a.slug}`} className="tl-card">
            <div className="tl-card-cover">
                {a.cover_path ? (
                    <img
                        src={resolveImageUrl(a.cover_path)}
                        alt={a.title}
                        loading="lazy"
                    />
                ) : (
                    <div className="tl-card-cover-empty">📄</div>
                )}
            </div>

            <div className="tl-card-body">
                <div className="tl-card-top">
          <span className="tl-card-date">
            <svg
                className="tl-card-date-icon"
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
            >
              <circle cx="12" cy="12" r="10"/>
              <path d="M12 6v6l4 2"/>
            </svg>
              {formatDateShort(a.created_at)}
          </span>
                    <span className="tl-card-likes">
            <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
            >
              <path
                  d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
            </svg>
                        {a.like_count}
          </span>
                </div>

                <h3 className="tl-card-title">{a.title}</h3>

                {a.excerpt && <p className="tl-card-excerpt">{a.excerpt}</p>}

                <div className="tl-card-footer">
                    <div className="tl-card-tags">
                        {a.category && (
                            <span className="tl-card-tag">{a.category}</span>
                        )}
                        {a.tags &&
                            parseTags(a.tags, 2).map((tag) => (
                                <span key={tag} className="tl-card-tag">
                    #{tag}
                  </span>
                            ))}
                    </div>
                    <div className="tl-card-stats">⏱ {a.read_time} min</div>
                </div>
            </div>
        </Link>
    );
}

export default function ArticlesPage() {
    return (
        <Suspense fallback={<div className="archive-empty">加载中...</div>}>
            <ArticlesContent/>
        </Suspense>
    );
}