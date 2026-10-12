"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MorphIcon } from "morphicons/react";
import {
  Feather,
  FileText,
  FolderKanban,
  Coffee,
  Home,
  Image as ImageIcon,
  Music,
  User,
  Users,
  Wrench,
} from "lucide";
import ThemeToggle from "./ThemeToggle";

const NAV_ITEMS = [
  { href: "/", label: "首页", icon: Home },
  { href: "/articles", label: "文章", icon: FileText },
  { href: "/essays", label: "随笔", icon: Feather },
  { href: "/life", label: "生活", icon: Coffee },
  { href: "/music", label: "音乐", icon: Music },
  { href: "/photos", label: "图片", icon: ImageIcon },
  { href: "/projects", label: "项目", icon: FolderKanban },
  { href: "/tools", label: "工具", icon: Wrench },
  { href: "/friends", label: "友链", icon: Users },
  { href: "/about", label: "关于", icon: User },
];

export default function Navbar() {
  const pathname = usePathname();

  // 后台页面不显示前台导航
  if (pathname.startsWith("/admin")) return null;

  return (
    <header
      className="fixed top-0 left-0 right-0 z-50"
      style={{
        // 半透明深色底
        background: "rgba(18, 20, 28, 0.72)",
        backdropFilter: "blur(20px) saturate(180%)",
        WebkitBackdropFilter: "blur(20px) saturate(180%)",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      <nav className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between gap-4">
        {/* 左：Logo */}
        <Link
          href="/"
          className="text-lg font-bold tracking-wide flex-shrink-0"
          id="site-logo"
        >
          My Blog
        </Link>

        {/* 右：导航 + 主题切换 */}
        <div className="flex items-center justify-end gap-12 flex-1 min-w-0">
          <ul className="flex items-center gap-5 transition-all duration-300">
            {NAV_ITEMS.map((item) => {
              const isActive =
                item.href === "/"
                  ? pathname === "/"
                  : pathname.startsWith(item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="flex items-center gap-1.5 text-sm transition-colors whitespace-nowrap"
                    style={{
                      color: isActive
                        ? "var(--accent)"
                        : "var(--text-secondary)",
                      fontWeight: isActive ? 600 : 400,
                    }}
                  >
                    <MorphIcon icon={item.icon} size={14} />
                    <span>{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>

          {/* 昼夜切换 */}
          <ThemeToggle />
        </div>
      </nav>
    </header>
  );
}