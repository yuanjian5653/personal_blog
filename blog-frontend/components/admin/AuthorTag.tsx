"use client";

import { useAuthors } from "@/lib/authors";

/**
 * 后台列表里的作者标签（纯文字，带「作者：」前缀）
 *
 * 管理员看所有人的内容时要一眼看出这条是谁发的；
 * 成员只看得到自己的内容，但标出来也无妨。
 */
export default function AuthorTag({ authorId }: { authorId?: number | null }) {
  const authors = useAuthors();
  if (authorId == null) return null;
  const author = authors.get(authorId);
  if (!author) return null;
  return (
    <span className="admin-muted text-xs" title={`作者：${author.name}`}>
      作者：{author.name}
    </span>
  );
}
