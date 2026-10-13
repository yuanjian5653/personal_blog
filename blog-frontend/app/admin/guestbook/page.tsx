"use client";

import CommentManager from "@/components/admin/CommentManager";

/**
 * 杂谈管理：只看留言板的留言（CommentManager 传 fixedTarget 即可）。
 * 留言板没有内容实体，管理的就是留言本身。
 */
export default function AdminGuestbookPage() {
  return <CommentManager fixedTarget="guestbook" title="杂谈管理" />;
}
