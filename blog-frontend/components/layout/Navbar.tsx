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
  { href: "/guestbook", label: "杂谈", icon: MessagesSquare },
  { href: "/about", label: "关于", icon: User },
];

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

/**
 * 悬浮「液态玻璃岛」导航栏。
 *
 * 结构说明见 app/styles/navbar.css 顶部注释。要点：
 * - 岛是悬浮胶囊，不是通栏：玻璃底只有 .nav-island__glass 一层做 backdrop-filter，
 *   这样液体指示器的 SVG gooey 滤镜不会被祖先的 backdrop-filter 吞掉。
 * - 活动指示器是一个胶囊，位置靠测量当前项得出（--liq-x / --liq-w），
 *   另有一个延迟跟随的"拖尾"块，两者被 gooey 滤镜焊在一起 →
 *   切换时呈现拉丝、分裂、合并的液体观感。切换瞬间再叠一层涟漪。
 * - ≥1200px 直接平铺全部栏目；更窄时收进汉堡 → 玻璃面板网格。
 */
export default function Navbar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  // 当前活动项的几何信息；null 表示还没量到（此时指示器隐藏，避免从左上角飞入）
  const [liq, setLiq] = useState<{ x: number; w: number } | null>(null);
  const trackRef = useRef<HTMLUListElement | null>(null);

  // 后台页面不显示前台导航
  const hidden = pathname.startsWith("/admin");

  const measure = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    const el = track.querySelector<HTMLElement>('[data-active="true"]');
    // offsetWidth 为 0 说明轨道被 CSS 隐藏了（移动端布局），此时不显示指示器
    if (!el || el.offsetWidth === 0) {
      setLiq(null);
      return;
    }
    setLiq({ x: el.offsetLeft, w: el.offsetWidth });
  }, []);

  // 量位置必须在浏览器完成布局之后。用 useEffect（而非 useLayoutEffect）
  // 是为了避开 SSR 期间 useLayoutEffect 的告警；第一帧的闪烁由 is-idle 隐藏兜住。
  useEffect(() => {
    measure();
  }, [pathname, measure]);

  useEffect(() => {
    const onResize = () => measure();
    window.addEventListener("resize", onResize);
    // 字体加载完成后文字宽度会变，重新量一次
    const fonts = (document as Document & { fonts?: { ready: Promise<unknown> } })
      .fonts;
    fonts?.ready.then(measure).catch(() => {});
    return () => window.removeEventListener("resize", onResize);
  }, [measure]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16);
    // 首帧放进 rAF：避免在 effect 体内同步 setState（同时兼容浏览器恢复滚动位置的情况）
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

  const trackStyle = {
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
      {/* gooey 滤镜已弃用（见 navbar.css 顶部注释）——改用玻璃胶囊 + 滞后光晕 + 涟漪 */}

      <nav className="nav-island" aria-label="主导航">
        {/* 玻璃底（唯一 backdrop-filter 层） */}
        <span className="nav-island__glass" aria-hidden="true" />
        {/* 镜面高光 */}
        <span className="nav-island__sheen" aria-hidden="true" />

        {/* Logo：首屏占位文字必须与后台 site_title 默认值一致，否则会闪 */}
        <Link href="/" className="nav-island__brand" id="site-logo">
          远见YuanJian
        </Link>

        {/* 移动端：当前栏目名 */}
        <span className="nav-island__current">{current?.label ?? ""}</span>

        {/* 桌面端：全部栏目 */}
        <ul className="nav-island__track" ref={trackRef} style={trackStyle}>
          {/* 液体指示器：滞后光晕在下，玻璃胶囊在上。
              只在量到位置后才挂载 —— 否则宽度会从 0 长出来。 */}
          <div className="nav-island__liquid-wrap" aria-hidden="true">
            {liq && (
              <>
                <span className="nav-island__liquid-glow" />
                <span className="nav-island__liquid" />
              </>
            )}
          </div>
          {liq && (
            <span
              key={pathname}
              className="nav-island__ripple"
              aria-hidden="true"
            />
          )}

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
                    <MorphIcon icon={item.icon} size={14} />
                  </span>
                  <span>{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>

        <div className="nav-island__actions">
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
          <MorphIcon icon={open ? X : Menu} size={18} />
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
                style={{ animationDelay: `${i * 26}ms` }}
              >
                <Link
                  href={item.href}
                  className={`nav-sheet__link${active ? " is-active" : ""}`}
                  aria-current={active ? "page" : undefined}
                  onClick={() => setOpen(false)}
                  tabIndex={open ? 0 : -1}
                >
                  <MorphIcon icon={item.icon} size={18} />
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
