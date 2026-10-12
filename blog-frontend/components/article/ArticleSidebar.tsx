"use client";

import { useRouter } from "next/navigation";
import AuthorCard from "./AuthorCard";
import MusicCard from "./MusicCard";
import CalendarCard from "./CalendarCard";
import RelatedCard from "./RelatedCard";
import type { ArticleListItem } from "@/lib/types";

interface ArticleSidebarProps {
  createdAt: string;
  siteConfig: Record<string, string>;
  related: ArticleListItem[];
  loading?: boolean;
}

export default function ArticleSidebar({
  createdAt,
  siteConfig,
  related,
  loading = false,
}: ArticleSidebarProps) {
  const router = useRouter();

  return (
    <aside className="article-sidebar">
      {/* 顶部返回按钮 */}
      <div className="sidebar-top">
        <button
          onClick={() => router.push("/articles")}
          className="back-btn"
          style={
            {
              "--btn-text": '"返回文章列表"',
            } as React.CSSProperties
          }
        >
          <svg
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            strokeWidth={2.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M10 19l-7-7m0 0l7-7m-7 7h18"
            />
          </svg>
          <p>返回文章列表</p>
        </button>
      </div>

      {/* 1. 作者卡片 */}
      <AuthorCard
        name={siteConfig.author_name || "博主"}
        bio={siteConfig.author_bio || ""}
        avatar={siteConfig.author_avatar || ""}
        loading={loading}
        socials={{
          github: siteConfig.social_github,
          email: siteConfig.social_email,
          telegram: siteConfig.social_telegram,
          discord: siteConfig.social_discord,
        }}
      />

      {/* 2. 音乐卡片 */}
      <MusicCard loading={loading} />

      {/* 3. 日历卡片 */}
      <CalendarCard date={createdAt} loading={loading} />

      {/* 4. 相关文章卡片 */}
      <RelatedCard articles={related.slice(0, 3)} loading={loading} />
    </aside>
  );
}