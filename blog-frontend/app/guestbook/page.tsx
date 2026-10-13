"use client";

import { MorphIcon } from "morphicons/react";
import { MessagesSquare } from "lucide";

import Comments from "@/components/comments/Comments";

/**
 * 杂谈 / 留言板
 *
 * 留言板没有"内容实体"——它就是一堆留言本身，
 * 所以在评论系统里用"三个目标外键全为空"表示（target="guestbook"）。
 * 每条留言都可以下拉展开查看他人回复。
 */
export default function GuestbookPage() {
  return (
    <div className="max-w-3xl mx-auto pt-2">
      {/* 标题 */}
      <div className="essays-hero">
        <div className="essays-hero-title-row">
          <div className="essays-hero-icon">
            <MorphIcon icon={MessagesSquare} size={26} />
          </div>
          <div>
            <h1 className="essays-hero-title">杂谈</h1>
            <p className="essays-hero-sub">随便聊聊，或者留下你的问题</p>
          </div>
        </div>
      </div>

      {/* 留言板本体：复用评论区组件（留言板 = 一个没有实体的评论目标） */}
      <div className="glass guestbook-card">
        <Comments
          target="guestbook"
          title="留言板"
          placeholder="说点什么吧…"
          emptyText="还没有留言，来写下第一条吧～"
        />
      </div>
    </div>
  );
}
