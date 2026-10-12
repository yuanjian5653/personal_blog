"use client";

import Link from "next/link";
import { MorphIcon } from "morphicons/react";
import { Link as LinkIcon } from "lucide";
import type { ArticleListItem } from "@/lib/types";
import { formatDateShort } from "@/lib/format";

interface RelatedCardProps {
  articles: ArticleListItem[];
  loading?: boolean;
}

export default function RelatedCard({
  articles,
  loading = false,
}: RelatedCardProps) {
  // 加载完成后若无文章则不显示
  if (!loading && articles.length === 0) return null;

  return (
    <div className="side-card">
      {loading ? (
        /* 骨架 */
        <div className="sk-related">
          <div className="sk-line w-30" />
          <div className="sk-related-list">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="sk-related-item">
                <div className="sk-line w-90" />
                <div className="sk-line w-40" />
              </div>
            ))}
          </div>
        </div>
      ) : (
        /* 真实内容 */
        <>
          <div className="side-related-header">
            <MorphIcon icon={LinkIcon} size={14} style={{ color: "var(--accent)" }}/>
            <span>相关文章</span>
          </div>
          <div className="side-related-list">
            {articles.map((r) => (
              <Link
                key={r.id}
                href={`/articles/${r.slug}`}
                className="side-related-item"
              >
                <h4 className="side-related-title">{r.title}</h4>
                <div className="side-related-date">
                  {formatDateShort(r.created_at)}
                </div>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}