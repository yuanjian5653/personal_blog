"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { fetchCurrentAdmin, logout } from "@/lib/auth";
import type { AdminInfo } from "@/lib/types";
import {
  AdminTab,
  closeTab,
  loadTabs,
  openTab,
  saveTabs,
} from "@/lib/adminTabs";

// 侧边栏菜单分组
const MENU_GROUPS: Array<{
  title?: string;
  items: Array<{ href: string; label: string; icon: string }>;
}> = [
  {
    items: [{ href: "/admin/dashboard", label: "仪表盘", icon: "🏠" }],
  },
  {
    title: "内容",
    items: [
      { href: "/admin/profile", label: "关于内容", icon: "👤" },
      { href: "/admin/posts", label: "文章管理", icon: "📝" },
      { href: "/admin/essays", label: "随笔管理", icon: "✍️" },
      { href: "/admin/life", label: "生活动态", icon: "☕" },
      { href: "/admin/music", label: "音乐管理", icon: "🎵" },
      { href: "/admin/photos", label: "图片管理", icon: "🖼️" },
    ],
  },
  {
    title: "互动",
    items: [
      { href: "/admin/comments", label: "评论管理", icon: "💬" },
      { href: "/admin/guestbook", label: "杂谈管理", icon: "📮" },
    ],
  },
  {
    title: "扩展",
    items: [
      { href: "/admin/projects", label: "项目管理", icon: "📦" },
      { href: "/admin/tools", label: "工具管理", icon: "🔧" },
      { href: "/admin/friends", label: "友链管理", icon: "🔗" },
    ],
  },
  {
    title: "系统",
    items: [
      { href: "/admin/site", label: "站点配置", icon: "⚙️" },
      { href: "/admin/logs", label: "操作日志", icon: "📋" },
    ],
  },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [admin, setAdmin] = useState<AdminInfo | null>(null);
  const [checking, setChecking] = useState(true);
  // 惰性初始化：客户端首次渲染就把已存标签读进来，省掉一次额外渲染。
  // SSR 阶段 sessionStorage 不存在，loadTabs() 返回 []，与客户端首帧一致。
  const [tabs, setTabs] = useState<AdminTab[]>(() => loadTabs());

  const isLoginPage = pathname === "/admin/login";

  // 认证守卫：拿当前登录态，未登录则跳登录页。
  // 所有 setState 都在异步回调里，不在 effect 主体里同步执行。
  useEffect(() => {
    if (isLoginPage) return;
    let cancelled = false;
    fetchCurrentAdmin()
      .then((a) => {
        if (cancelled) return;
        if (!a) router.replace("/admin/login");
        else setAdmin(a);
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isLoginPage, router]);

  // 登录页本身不需要"正在校验登录态"的过场，直接派生出来
  const showChecking = !isLoginPage && checking;

  // 标签栏管理：载入已存标签，并在路径变化时打开对应标签。
  // 这里必须读写 sessionStorage（外部系统），且要同步反映到 UI，
  // 属于该规则描述里"proper external data synchronization"的正当用法。
  useEffect(() => {
    if (isLoginPage) return;
    /* eslint-disable react-hooks/set-state-in-effect -- 与 sessionStorage 同步，见上 */
    setTabs((prev) => {
      const withCurrent = openTab(prev, pathname);
      saveTabs(withCurrent);
      return withCurrent;
    });
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [pathname, isLoginPage]);

  const handleCloseTab = (href: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const next = closeTab(tabs, href);
    setTabs(next);
    saveTabs(next);
    // 如果关闭的是当前页，跳到最右侧标签
    if (href === pathname) {
      const last = next[next.length - 1];
      router.push(last ? last.href : "/admin/dashboard");
    }
  };

  if (isLoginPage) return <>{children}</>;

  if (showChecking) {
    return (
      <div className="text-center py-20" style={{ color: "var(--text-secondary)" }}>
        验证登录状态...
      </div>
    );
  }

  if (!admin) return null;

  const handleLogout = async () => {
    await logout();
    sessionStorage.removeItem("admin_tabs");
    router.replace("/admin/login");
  };

  return (
    <div className="fixed inset-0 top-0 flex bg-[var(--bg-primary)] z-50">
      {/* ==================== 侧边栏 ==================== */}
      <aside className="w-56 flex-shrink-0 border-r border-white/10 flex flex-col bg-[rgba(15,17,21,0.95)]">
        {/* Logo */}
        <div className="p-5 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white flex-shrink-0"
              style={{ background: "var(--accent)" }}
            >
              {admin.username[0].toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="text-sm font-bold truncate">管理后台</div>
              <div
                className="text-xs truncate"
                style={{ color: "var(--text-secondary)" }}
              >
                {admin.username}
              </div>
            </div>
          </div>
        </div>

        {/* 菜单 */}
        <nav className="flex-1 overflow-y-auto p-3 space-y-4">
          {MENU_GROUPS.map((group, gi) => (
            <div key={gi}>
              {group.title && (
                <div
                  className="text-[10px] uppercase tracking-widest px-3 mb-1"
                  style={{ color: "var(--text-secondary)" }}
                >
                  {group.title}
                </div>
              )}
              <ul className="space-y-0.5">
                {group.items.map((item) => {
                  const active = pathname.startsWith(item.href);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors"
                        style={{
                          background: active
                            ? "var(--accent)"
                            : "transparent",
                          color: active ? "#fff" : "var(--text-primary)",
                        }}
                      >
                        <span className="text-base">{item.icon}</span>
                        <span className="truncate">{item.label}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        {/* 底部操作 */}
        <div className="p-3 border-t border-white/10 space-y-0.5">
          <Link
            href="/"
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm hover:bg-white/5 transition-colors"
          >
            <span>←</span>
            <span>返回前台</span>
          </Link>
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm hover:bg-white/5 transition-colors text-left"
            style={{ color: "#f87171" }}
          >
            <span>⏻</span>
            <span>登出</span>
          </button>
        </div>
      </aside>

      {/* ==================== 主区域 ==================== */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* 顶部标签栏 */}
        <div
          className="h-12 flex-shrink-0 flex items-center gap-1 px-3 overflow-x-auto border-b border-white/10"
          style={{ background: "rgba(15,17,21,0.6)" }}
        >
          {tabs.length === 0 ? (
            <span
              className="text-xs px-3"
              style={{ color: "var(--text-secondary)" }}
            >
              无打开的页面
            </span>
          ) : (
            tabs.map((tab) => {
              const active = tab.href === pathname;
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  className="group flex items-center gap-2 px-3 py-1.5 rounded-md text-xs whitespace-nowrap transition-colors"
                  style={{
                    background: active
                      ? "rgba(124,92,255,0.15)"
                      : "rgba(255,255,255,0.03)",
                    color: active ? "var(--accent)" : "var(--text-secondary)",
                  }}
                >
                  <span>{tab.label}</span>
                  {/* 仪表盘不可关闭 */}
                  {tab.href !== "/admin/dashboard" && (
                    <button
                      onClick={(e) => handleCloseTab(tab.href, e)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity w-4 h-4 rounded flex items-center justify-center hover:bg-white/10 text-xs"
                      title="关闭"
                    >
                      ×
                    </button>
                  )}
                </Link>
              );
            })
          )}
        </div>

        {/* 内容区 */}
        <main className="flex-1 overflow-y-auto p-8">{children}</main>
      </div>
    </div>
  );
}