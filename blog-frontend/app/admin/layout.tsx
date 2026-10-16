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

/** 路径 → 顶栏标题。用最长前缀匹配，子页面（如 /admin/posts/new）也能拿到标题。 */
const PATH_TITLES: Array<[string, string]> = [
  ["/admin/dashboard", "仪表盘"],
  ["/admin/profile", "关于内容"],
  ["/admin/posts", "文章管理"],
  ["/admin/essays", "随笔管理"],
  ["/admin/life", "生活动态"],
  ["/admin/music", "音乐管理"],
  ["/admin/photos", "图片管理"],
  ["/admin/comments", "评论管理"],
  ["/admin/guestbook", "杂谈管理"],
  ["/admin/projects", "项目管理"],
  ["/admin/tools", "工具管理"],
  ["/admin/friends", "友链管理"],
  ["/admin/site", "站点配置"],
  ["/admin/logs", "操作日志"],
];

function titleOf(pathname: string): string {
  // 找匹配得最长的那个前缀，避免 /admin/posts 抢先匹配 /admin/posts/new 之外的情况
  let best = "";
  let label = "管理后台";
  for (const [href, text] of PATH_TITLES) {
    if (pathname.startsWith(href) && href.length > best.length) {
      best = href;
      label = text;
    }
  }
  return label;
}

/** 顶部小图标按钮：只是入口，不做假交互 */
function TopIcon({
  href,
  title,
  children,
}: {
  href: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Link className="admin-topbar__icon" href={href} title={title} aria-label={title}>
      {children}
    </Link>
  );
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [admin, setAdmin] = useState<AdminInfo | null>(null);
  const [checking, setChecking] = useState(true);
  // 惰性初始化：客户端首次渲染就把已存标签读进来，省掉一次额外渲染。
  // SSR 阶段 sessionStorage 不存在，loadTabs() 返回 []，与客户端首帧一致。
  const [tabs, setTabs] = useState<AdminTab[]>(() => loadTabs());
  // 侧边栏折叠。初始 false，避免 SSR/首帧不一致
  const [collapsed, setCollapsed] = useState(false);

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

  const handleLogout = async () => {
    await logout();
    sessionStorage.removeItem("admin_tabs");
    router.replace("/admin/login");
  };

  if (isLoginPage) {
    // 登录页在后台外壳之外，用同样的亮色主题包裹，避免白底站点上突然出现深色卡片
    return <div className="admin-shell admin-shell--plain">{children}</div>;
  }

  if (showChecking) {
    return (
      <div className="admin-shell admin-shell--plain admin-boot">
        <span className="admin-boot__spinner" />
        验证登录状态…
      </div>
    );
  }

  if (!admin) return null;

  return (
    <div
      className={`admin-shell fixed inset-0 z-50${
        collapsed ? " is-collapsed" : ""
      }`}
    >
      {/* ==================== 侧边栏 ==================== */}
      <aside className="admin-side">
        {/* Logo / 站点名 */}
        <div className="admin-side__brand">
          <span className="admin-side__avatar" aria-hidden="true">
            {admin.username[0].toUpperCase()}
          </span>
          {!collapsed && (
            <span className="admin-side__brand-text">
              <strong>个人博客</strong>
              <em>管理后台</em>
            </span>
          )}
        </div>

        {/* 折叠按钮：浮在侧边栏右边缘 */}
        <button
          type="button"
          className="admin-side__toggle"
          onClick={() => setCollapsed((v) => !v)}
          title={collapsed ? "展开侧边栏" : "收起侧边栏"}
          aria-label={collapsed ? "展开侧边栏" : "收起侧边栏"}
          aria-expanded={!collapsed}
        >
          {collapsed ? "›" : "‹"}
        </button>

        {/* 菜单 */}
        <nav className="admin-nav">
          {MENU_GROUPS.map((group, gi) => (
            <div className="admin-nav__group" key={gi}>
              {group.title &&
                (collapsed ? (
                  // 折叠时分组标题没地方放，用一条细分隔线代替
                  <span className="admin-nav__divider" aria-hidden="true" />
                ) : (
                  <div className="admin-nav__title">{group.title}</div>
                ))}
              <ul>
                {group.items.map((item) => {
                  const active = pathname.startsWith(item.href);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className={`admin-nav__link${active ? " is-active" : ""}`}
                        title={collapsed ? item.label : undefined}
                      >
                        <span className="admin-nav__icon">{item.icon}</span>
                        {!collapsed && (
                          <span className="admin-nav__label">{item.label}</span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        {/* 底部操作 */}
        <div className="admin-side__foot">
          <Link
            href="/"
            className="admin-nav__link"
            title={collapsed ? "返回前台" : undefined}
          >
            <span className="admin-nav__icon">←</span>
            {!collapsed && <span className="admin-nav__label">返回前台</span>}
          </Link>
          <button
            type="button"
            onClick={handleLogout}
            className="admin-nav__link admin-nav__link--danger"
            title={collapsed ? "登出" : undefined}
          >
            <span className="admin-nav__icon">⏻</span>
            {!collapsed && <span className="admin-nav__label">登出</span>}
          </button>
        </div>
      </aside>

      {/* ==================== 主区域 ==================== */}
      <div className="admin-main">
        {/* 顶栏 */}
        <header className="admin-topbar">
          <h1 className="admin-topbar__title">{titleOf(pathname)}</h1>

          <div className="admin-topbar__right">
            {/* 搜索入口：真实的入口（跳到评论管理），不是假的输入框 */}
            <Link className="admin-topbar__search" href="/admin/comments">
              <span aria-hidden="true">🔍</span>
              <span>搜索评论…</span>
            </Link>

            <TopIcon href="/admin/logs" title="操作日志">
              🕘
            </TopIcon>
            <TopIcon href="/admin/comments" title="评论管理">
              💬
            </TopIcon>
            <TopIcon href="/admin/dashboard" title="全屏看板">
              ⤢
            </TopIcon>

            <span className="admin-topbar__user" title={admin.username}>
              <span className="admin-topbar__user-avatar" aria-hidden="true">
                {admin.username[0].toUpperCase()}
              </span>
              {admin.username}
            </span>
          </div>
        </header>

        {/* 标签栏 */}
        <div className="admin-tabs">
          {tabs.length === 0 ? (
            <span className="admin-tabs__empty">无打开的页面</span>
          ) : (
            tabs.map((tab) => {
              const active = tab.href === pathname;
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  className={`admin-tab${active ? " is-active" : ""}`}
                >
                  <span>{tab.label}</span>
                  {/* 仪表盘不可关闭 */}
                  {tab.href !== "/admin/dashboard" && (
                    <button
                      onClick={(e) => handleCloseTab(tab.href, e)}
                      className="admin-tab__close"
                      title="关闭"
                      aria-label={`关闭 ${tab.label}`}
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
        <main className="admin-content">{children}</main>
      </div>
    </div>
  );
}
