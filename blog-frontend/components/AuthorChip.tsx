"use client";

import { useAuthors } from "@/lib/authors";

/**
 * 内容作者标签（"成员标签"）。
 *
 * 什么时候显示：
 *   · 作者表里**有作品的作者 ≥ 2 个**（单人站不显示，否则是噪声）
 *   · author_id 能在作者表里查到
 *
 * 数据来源是全局缓存，一个列表页只请求一次 /api/authors。
 */
interface Props {
  authorId?: number | null;
  className?: string;
}

export default function AuthorChip({ authorId, className = "" }: Props) {
  const authors = useAuthors();

  if (authorId == null) return null;
  const author = authors.get(authorId);
  if (!author) return null;

  const withContent = Array.from(authors.values()).filter((a) => a.has_content);
  if (withContent.length <= 1) return null;

  return (
    <span className={`author-chip ${className}`.trim()} title={author.name}>
      {author.avatar ? (
        <img className="author-chip__avatar" src={author.avatar} alt="" />
      ) : (
        <span className="author-chip__dot" aria-hidden="true" />
      )}
      {author.name}
    </span>
  );
}
