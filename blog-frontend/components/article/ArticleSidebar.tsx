"use client";

import { useAuthors } from "@/lib/authors";
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
  authorId?: number | null;
}

export default function ArticleSidebar({
  createdAt,
  siteConfig,
  authorId,
  related,
  loading = false,
}: ArticleSidebarProps) {
  const router = useRouter();

  // 文章作者：成员写的文章显示成员自己的头像/昵称/简介/社交；
  // 找不到时退回站点配置（站长自己的那张卡片）
  const authors = useAuthors();
  const articleAuthor =
    authorId != null ? authors.get(authorId) : undefined;

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
        name={articleAuthor?.name || siteConfig.author_name || "博主"}
        bio={articleAuthor?.bio || siteConfig.author_bio || ""}
        avatar={articleAuthor?.avatar || siteConfig.author_avatar || ""}
        loading={loading}
        socials={{
          github: articleAuthor?.social_github || siteConfig.social_github,
          email: articleAuthor?.social_email || siteConfig.social_email,
          telegram:
            articleAuthor?.social_telegram || siteConfig.social_telegram,
          discord: articleAuthor?.social_discord || siteConfig.social_discord,
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