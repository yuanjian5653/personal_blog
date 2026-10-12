"use client";

import type { Essay } from "@/lib/types";

function relativeTime(s: string): string {
  const d = new Date(s).getTime();
  const diff = Date.now() - d;
  const min = Math.floor(diff / 60000);
  const hour = Math.floor(diff / 3600000);
  const day = Math.floor(diff / 86400000);

  if (min < 1) return "刚刚";
  if (min < 60) return `${min}分钟前`;
  if (hour < 24) return `${hour}小时前`;
  if (day < 30) return `${day}天前`;
  const dd = new Date(s);
  return `${dd.getFullYear()}.${String(dd.getMonth() + 1).padStart(2, "0")}.${String(
    dd.getDate()
  ).padStart(2, "0")}`;
}

interface Props {
  essay: Essay;
  onClick: () => void;
}

export default function EssayItem({ essay, onClick }: Props) {
  return (
    <div className="essay-item" onClick={onClick}>
      {/* 顶部：相对时间 + 图片标记 */}
      <div className="essay-item-head">
        <span className="essay-item-time">
          {relativeTime(essay.created_at)}
        </span>
        {essay.images.length > 0 && (
          <span className="essay-item-badge">
            {essay.images.length} 图
          </span>
        )}
      </div>

      {/* 内容：截断 */}
      <p className="essay-item-content">
        {essay.content || essay.title || "（无内容）"}
      </p>
    </div>
  );
}