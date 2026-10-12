"use client";

import Link from "next/link";

const CARDS = [
  { title: "站点配置", desc: "标题、主题色、背景", href: "/admin/site", icon: "⚙️" },
  { title: "音乐管理", desc: "歌曲与歌单", href: "/admin/music", icon: "🎵" },
  { title: "文章管理", desc: "日记与长文", href: "/admin/posts", icon: "📝" },
  { title: "随笔管理", desc: "碎片化记录", href: "/admin/essays", icon: "✍️" },
  { title: "图片管理", desc: "相册与照片", href: "/admin/photos", icon: "🖼️" },
  { title: "操作日志", desc: "查看变更记录", href: "/admin/logs", icon: "📋" },
    { title: "生活动态", desc: "日常片段管理", href: "/admin/life", icon: "☕" },
];

export default function DashboardPage() {
  return (
    <div className="space-y-6 max-w-5xl">
      <h1 className="text-2xl font-bold">仪表盘</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {CARDS.map((card) => (
          <Link
            key={card.href}
            href={card.href}
            className="glass p-5 block hover:scale-[1.02] transition-transform"
          >
            <div className="flex items-center gap-3 mb-2">
              <span className="text-xl">{card.icon}</span>
              <span className="font-semibold">{card.title}</span>
            </div>
            <div className="text-xs" style={{ color: "var(--text-secondary)" }}>
              {card.desc}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}