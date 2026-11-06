"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { MorphIcon } from "morphicons/react";
import {
  Feather,
  FileText,
  FolderKanban,
  Coffee,
  Home,
  Image as ImageIcon,
  Menu,
  MessagesSquare,
  Music,
  User,
  Users,
  Wrench,
  X,
} from "lucide";
import NoticeBell from "./NoticeBell";
import ThemeToggle from "./ThemeToggle";
import { resolveLiquidGeometry } from "@/lib/navGeometry";

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
  { href: "/guestbook", label: "杂谈", icon: MessagesSquare },
  { href: "/about", label: "关于", icon: User },
];

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

/**
 * 悬浮玻璃岛导航栏。
 *
 * 保持克制：一层玻璃底 + 一个随当前栏目滑动的胶囊。
 * 不加拖尾光晕、连接桥、跟随鼠标的弯月面，也不做涟漪 ——
 * 和站点其它地方的简约风格保持一致。
 *
 * 玻璃底直接做在 .nav-island 上（不需要额外的层），
 * 指示器几何靠 lib/navGeometry 量出当前 <li> 的位置。
 * ≥1200px 平铺全部栏目；更窄时收进汉堡 → 玻璃面板网格。
 */
export default function Navbar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  // 当前活动项的几何信息；null 表示还没量到（此时不渲染指示器）
  const [liq, setLiq] = useState<{ x: number; w: number } | null>(null);
  const trackRef = useRef<HTMLUListElement | null>(null);

  // 后台页面不显示前台导航
  const hidden = pathname.startsWith("/admin");

  const measure = useCallback(() => {
    setLiq(resolveLiquidGeometry(trackRef.current));
  }, []);

  // 量位置必须在浏览器完成布局之后。用 useEffect（而非 useLayoutEffect）
  // 是为了避开 SSR 期间 useLayoutEffect 的告警；首帧闪烁由"量到才渲染"兜住。
  useEffect(() => {
    measure();
  }, [pathname, measure]);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;

    const onResize = () => measure();
    window.addEventListener("resize", onResize);

    // ThemeToggle 是水合后才渲染真实开关的，岛屿宽度会变、轨道整体位移，
    // 只监听 window resize 会漏掉这种变化，所以直接观察元素尺寸。
    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => measure())
        : null;
    ro?.observe(track);
    if (track.parentElement) ro?.observe(track.parentElement);

    // 字体加载完成后文字宽度会变，重新量一次
    const fonts = (document as Document & { fonts?: { ready: Promise<unknown> } })
      .fonts;
    fonts?.ready.then(measure).catch(() => {});

    return () => {
      window.removeEventListener("resize", onResize);
      ro?.disconnect();
    };
  }, [measure]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16);
    // 首帧放进 rAF：避免在 effect 体内同步 setState（同时兼容浏览器恢复滚动位置）
    const raf = requestAnimationFrame(onScroll);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  // Esc 关闭移动端面板
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (hidden) return null;

  const current = NAV_ITEMS.find((i) => isActive(pathname, i.href));

  const liquidVars = {
    "--liq-x": `${liq?.x ?? 0}px`,
    "--liq-w": `${liq?.w ?? 0}px`,
  } as React.CSSProperties;

  return (
    <header
      className={[
        "nav-island-root",
        scrolled ? "is-scrolled" : "",
        open ? "is-menu-open" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <nav className="nav-island" aria-label="主导航">
        {/* Logo：首屏占位文字必须与后台 site_title 默认值一致，否则会闪 */}
        <Link href="/" className="nav-island__brand" id="site-logo">
          远见YuanJian
        </Link>

        {/* 移动端：当前栏目名 */}
        <span className="nav-island__current">{current?.label ?? ""}</span>

        {/* 桌面端：全部栏目。<ul> 里只能有 <li>，所以指示器放在外面的包裹层 */}
        <div className="nav-island__nav" style={liquidVars}>
          <div className="nav-island__liquid-wrap" aria-hidden="true">
            {liq && <span className="nav-island__liquid" />}
          </div>

          <ul className="nav-island__track" ref={trackRef}>
            {NAV_ITEMS.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <li className="nav-island__item" key={item.href}>
                  <Link
                    href={item.href}
                    className={`nav-island__link${active ? " is-active" : ""}`}
                    data-active={active ? "true" : "false"}
                    aria-current={active ? "page" : undefined}
                  >
                    <span className="nav-island__icon">
                      <MorphIcon icon={item.icon} size={16} />
                    </span>
                    <span>{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="nav-island__actions">
          <NoticeBell />
          <ThemeToggle />
        </div>

        <button
          type="button"
          className="nav-island__burger"
          aria-label={open ? "关闭菜单" : "打开菜单"}
          aria-expanded={open}
          aria-controls="nav-sheet"
          onClick={() => setOpen((v) => !v)}
        >
          <MorphIcon icon={open ? X : Menu} size={20} />
        </button>
      </nav>

      {/* 移动端展开面板 */}
      <div
        id="nav-sheet"
        className={`nav-sheet${open ? " is-open" : ""}`}
        aria-hidden={!open}
      >
        <ul className="nav-sheet__grid">
          {NAV_ITEMS.map((item, i) => {
            const active = isActive(pathname, item.href);
            return (
              <li
                className="nav-sheet__item"
                key={item.href}
                style={{ animationDelay: `${i * 24}ms` }}
              >
                <Link
                  href={item.href}
                  className={`nav-sheet__link${active ? " is-active" : ""}`}
                  aria-current={active ? "page" : undefined}
                  onClick={() => setOpen(false)}
                  tabIndex={open ? 0 : -1}
                >
                  <MorphIcon icon={item.icon} size={19} />
                  <span>{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </header>
  );
}
