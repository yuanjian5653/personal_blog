"use client";

import { createPortal } from "react-dom";
import { useCallback, useEffect, useRef, useState } from "react";
import { MorphIcon } from "morphicons/react";
import { Palette, X } from "lucide";

import { api } from "@/lib/api";
import {
  applyTheme,
  commitTheme,
  isDefaultTheme,
  readThemeOverride,
  themeFromConfigs,
  type ThemeLike,
} from "@/lib/theme";

/**
 * 主题切换器（导航栏最右）
 *
 * 选项 = 默认主题（站长在「站点配置」里的那套）+ 管理员已上线的成员主题。
 *
 * ── 为什么用 portal 渲染到 body ──
 *   展开的选项要飘出导航栏之外。放在导航栏内部会踩两个坑：
 *     1. 导航栏有 backdrop-filter，会形成包含块，fixed 定位失效
 *     2. 祖先的层叠上下文 / overflow 会把飘出去的部分裁掉
 *   渲染到 body + fixed 定位，就完全不受导航栏影响。
 *
 * ── 为什么向左下展开 ──
 *   按钮在页面最上方（导航栏里），**向上弹会直接出屏幕**。
 *   向左下一条弧线，既不出视口，也不压住右侧其它按钮。
 */
export default function ThemeSwitcher() {
  const [open, setOpen] = useState(false);
  /** 主按钮在视口里的位置：展开面板以此为锚点 */
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const [themes, setThemes] = useState<ThemeLike[]>([]);
  const [defaultTheme, setDefaultTheme] = useState<ThemeLike | null>(null);
  const mainRef = useRef<HTMLButtonElement | null>(null);

  // 上次选的主题：惰性初始化读一次（在 effect 里同步 setState 会被
  // react-hooks/set-state-in-effect 拦下，这个规则本项目踩过多次）
  const [currentId, setCurrentId] = useState<number | null>(() => {
    if (typeof window === "undefined") return null;
    const saved = readThemeOverride();
    return !isDefaultTheme() && saved ? saved.admin_id : null;
  });

  useEffect(() => {
    let alive = true;
    api
      .get<ThemeLike[]>("/api/themes")
      .then((rows) => {
        if (alive) setThemes(rows);
      })
      .catch(() => undefined);
    api
      .get<{ configs: Record<string, string> }>("/api/site-config")
      .then(({ configs }) => {
        if (alive) setDefaultTheme(themeFromConfigs(configs));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  // 把上次选的主题真正写到 :root（副作用，不涉及 setState）
  useEffect(() => {
    const saved = readThemeOverride();
    if (!isDefaultTheme() && saved) applyTheme(saved);
  }, []);

  // Esc 关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // 滚动 / 改窗口大小时收起：锚点坐标会失效，留着会飘到奇怪的位置
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("scroll", close, { passive: true });
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  const toggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    const r = mainRef.current?.getBoundingClientRect();
    if (!r) return;
    setAnchor({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
    setOpen(true);
  };

  const pick = useCallback(
    (theme: ThemeLike | null) => {
      setOpen(false);
      if (!theme) {
        commitTheme(null);
        setCurrentId(null);
        applyTheme(defaultTheme ?? null);
        return;
      }
      commitTheme(theme);
      applyTheme(theme);
      setCurrentId(theme.admin_id);
    },
    [defaultTheme]
  );

  // 主按钮的强调色 = 当前选中主题的强调色（派生，不用 state）
  const accent =
    (currentId === null
      ? defaultTheme?.theme_accent
      : themes.find((x) => x.admin_id === currentId)?.theme_accent) ||
    defaultTheme?.theme_accent ||
    "#7c5cff";

  // 没有可选主题时整块隐藏（只有默认主题，切换没意义）
  if (themes.length === 0) return null;

  const RADIUS = 92;
  // 100° → 175°：从"正下方"扫到"正左方"，避开屏幕顶端
  const START_DEG = 100;
  const END_DEG = 175;
  const total = themes.length + 1; // 含"默认主题"
  const pos = (i: number) => {
    const deg =
      total <= 1
        ? START_DEG
        : START_DEG + ((END_DEG - START_DEG) * i) / (total - 1);
    const rad = (deg * Math.PI) / 180;
    return { x: Math.cos(rad) * RADIUS, y: Math.sin(rad) * RADIUS };
  };

  const options: Array<{
    key: number | null;
    label: string;
    dot: string;
    theme?: ThemeLike;
  }> = [
    {
      key: null,
      label: "默认主题",
      dot: defaultTheme?.theme_accent || "#7c5cff",
    },
    ...themes.map((t) => ({
      key: t.admin_id as number | null,
      label: t.name || t.owner_name,
      dot: t.theme_accent || "#7c5cff",
      theme: t,
    })),
  ];

  return (
    <>
      <button
        ref={mainRef}
        type="button"
        className={`theme-sw__main${open ? " is-open" : ""}`}
        style={{ "--sw-accent": accent } as React.CSSProperties}
        aria-label={open ? "关闭主题菜单" : "切换主题"}
        aria-expanded={open}
        onClick={toggle}
      >
        <MorphIcon icon={open ? X : Palette} size={16} />
      </button>

      {/* 只在用户点开后才渲染 → 服务端不会碰到 document，
          也不会有 hydration 不一致 */}
      {open &&
        anchor &&
        typeof document !== "undefined" &&
        createPortal(
          <>
            <button
              type="button"
              className="theme-sw__scrim"
              aria-label="关闭主题菜单"
              onClick={() => setOpen(false)}
            />
            <div
              className="theme-sw__panel"
              style={{ left: anchor.x, top: anchor.y }}
              role="menu"
            >
              {options.map((o, i) => {
                const { x, y } = pos(i);
                const active = o.key === currentId;
                return (
                  <button
                    key={o.key ?? "default"}
                    type="button"
                    role="menuitem"
                    className={`theme-sw__item${active ? " is-active" : ""}`}
                    style={
                      {
                        "--sw-x": `${x}px`,
                        "--sw-y": `${y}px`,
                        "--sw-delay": `${i * 40}ms`,
                        "--sw-dot": o.dot,
                      } as React.CSSProperties
                    }
                    onClick={() => pick(o.theme ?? null)}
                  >
                    <span className="theme-sw__dot" />
                    <span className="theme-sw__label">{o.label}</span>
                  </button>
                );
              })}
            </div>
          </>,
          document.body
        )}
    </>
  );
}
