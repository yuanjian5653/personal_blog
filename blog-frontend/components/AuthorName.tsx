"use client";

import { useAuthors } from "@/lib/authors";

/**
 * 署名（「—— 作者名」）
 *
 * 用在说说这种短文本内容后面，模仿名人名句的署名排版。
 * 名字取自关于页里设置的昵称（见 /api/authors）。
 * author_id 为空或查不到时不渲染。
 */
export default function AuthorName({ authorId }: { authorId?: number | null }) {
  const authors = useAuthors();
  if (authorId == null) return null;
  const author = authors.get(authorId);
  if (!author) return null;
  return <span className="essay-item-sign__name">—— {author.name}</span>;
}
