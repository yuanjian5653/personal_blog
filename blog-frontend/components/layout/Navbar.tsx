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

/** 连接桥的存在时长：略短于胶囊的滑动时长（620ms），收尾时自然消失 */
const BRIDGE_MS = 540;

/**
 * 悬浮「液态玻璃岛」导航栏。
 *
 * 结构说明见 app/styles/navbar.css 顶部注释。要点：
 * - 岛是悬浮胶囊，不是通栏：玻璃底只有 .nav-island__glass 一层做 backdrop-filter。
 * - 活动指示器是一个玻璃胶囊，位置靠测量当前项得出（--liq-x / --liq-w）。
 * - 液态观感由三层叠加，全部是 DOM + CSS 变量，不用 SVG/WebGL 滤镜：
 *     1) 滞后跟随的模糊光晕 → 滑动时拖出"水尾"
 *     2) 跨栏位移时铺一条连接桥（.nav-island__bridge）→ 水滴被拉长再收回
 *     3) 到位时一圈涟漪（.nav-island__ripple）
 * - 鼠标在岛上移动时，光标位置会带起一个"弯月面"高光（.nav-island__meniscus）。
 * - ≥1200px 直接平铺全部栏目；更窄时收进汉堡 → 玻璃面板网格。
 */
export default function Navbar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  // 当前活动项的几何信息；null 表示还没量到（此时指示器隐藏，避免从左上角飞入）
  const [liq, setLiq] = useState<{ x: number; w: number } | null>(null);
  // 跨栏位移时的"液体连接桥"几何；null 表示当前没有过渡
  const [bridge, setBridge] = useState<{ x: number; w: number } | null>(null);
  // 光标在导航轨道内的横坐标（弯月面高光的位置）；null 表示指针不在岛上
  const [meniscusX, setMeniscusX] = useState<number | null>(null);
  const trackRef = useRef<HTMLUListElement | null>(null);
  const navRef = useRef<HTMLDivElement | null>(null);
  // 上一帧的指示器几何：用来判断这次是不是"跨栏位移"
  const liqRef = useRef<{ x: number; w: number } | null>(null);
  const bridgeTimer = useRef<number | null>(null);

  // 后台页面不显示前台导航
  const hidden = pathname.startsWith("/admin");

  const measure = useCallback(() => {
    // "量哪个元素"的逻辑抽在 lib/navGeometry.ts —— 那里踩过一个坑：
    // 量 <a> 会恒得 offsetLeft=0（<a> 的 offsetParent 是它自己的 <li>），
    // 抽成纯函数后可以用假对象做无浏览器的回归测试。
    const next = resolveLiquidGeometry(trackRef.current);
    const prev = liqRef.current;
    liqRef.current = next;
    setLiq(next);

    // 跨栏位移时铺一条"液体连接桥"：从旧位置一直盖到新位置，
    // 视觉上就是水滴被拉长、然后在新位置收回来（参考稿的核心手感）。
    // 位移太小（同栏重排）就不铺，避免闪一下。
    if (prev && next && Math.abs(prev.x - next.x) > 8) {
      const left = Math.min(prev.x, next.x);
      const right = Math.max(prev.x + prev.w, next.x + next.w);
      setBridge({ x: left, w: right - left });
      if (bridgeTimer.current) window.clearTimeout(bridgeTimer.current);
      bridgeTimer.current = window.setTimeout(() => setBridge(null), BRIDGE_MS);
    }
  }, []);

  // 量位置必须在浏览器完成布局之后。用 useEffect（而非 useLayoutEffect）
  // 是为了避开 SSR 期间 useLayoutEffect 的告警；第一帧的闪烁由
  // "量到位置才挂载指示器"兜住。
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

  // 卸载时清掉连接桥的定时器，避免对已卸载组件 setState
  useEffect(() => {
    return () => {
      if (bridgeTimer.current) window.clearTimeout(bridgeTimer.current);
    };
  }, []);

  // 弯月面高光：跟着鼠标在轨道内的横坐标走。
  // 触屏（pointerType !== "mouse"）不启用，否则点击后会留下一个残影。
  const onNavPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "mouse") return;
    const box = navRef.current?.getBoundingClientRect();
    if (!box) return;
    setMeniscusX(Math.round(e.clientX - box.left));
  };
  const onNavPointerLeave = () => setMeniscusX(null);

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

        {/* 桌面端：全部栏目。
            液体层放在 <ul> 外面：<ul> 里只能有 <li>。 */}
        <div
          className="nav-island__nav"
          ref={navRef}
          style={liquidVars}
          onPointerMove={onNavPointerMove}
          onPointerLeave={onNavPointerLeave}
        >
          <div className="nav-island__liquid-wrap" aria-hidden="true">
            {liq && (
              <>
                <span className="nav-island__liquid-glow" />
                <span className="nav-island__liquid" />
                {bridge && (
                  <span
                    key={`bridge-${bridge.x}-${bridge.w}`}
                    className="nav-island__bridge"
                    style={
                      {
                        "--bridge-x": `${bridge.x}px`,
                        "--bridge-w": `${bridge.w}px`,
                      } as React.CSSProperties
                    }
                  />
                )}
                <span
                  className={`nav-island__meniscus${
                    meniscusX === null ? "" : " is-on"
                  }`}
                  style={
                    { "--men-x": `${meniscusX ?? 0}px` } as React.CSSProperties
                  }
                />
                <span key={pathname} className="nav-island__ripple" />
              </>
            )}
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
                      <MorphIcon icon={item.icon} size={14} />
                    </span>
                    <span>{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>

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
