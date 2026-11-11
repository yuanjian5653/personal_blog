"use client";

import { useCallback, useEffect, useState } from "react";
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
 * 选项 = 默认主题（站长的站点配置）+ 管理员已上线的成员主题。
 * 点一下立即生效，不等网络。
 *
 * 交互沿用「关于」页那套浮动按钮的思路：
 *   主按钮是个圆形图标，点开后选项沿**左侧**弧线展开，
 *   悬停显示主题名；主按钮本身显示当前主题的强调色。
 *
 * 位置在导航栏内部（不是 fixed），因为这里空间够、也更符合"工具按钮"定位。
 */
export default function ThemeSwitcher() {
  const [open, setOpen] = useState(false);
  const [themes, setThemes] = useState<ThemeLike[]>([]);
  const [defaultTheme, setDefaultTheme] = useState<ThemeLike | null>(null);
  // 上次选的主题：惰性初始化读一次（在 effect 里同步 setState 会被
  // react-hooks/set-state-in-effect 拦下，这个规则本项目踩过多次）
  const [currentId, setCurrentId] = useState<number | null>(() => {
    if (typeof window === "undefined") return null;
    const saved = readThemeOverride();
    return !isDefaultTheme() && saved ? saved.admin_id : null;
  });


  // 拉主题列表 + 站配置（默认主题）
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

  // 主按钮的强调色 = 当前选中主题的强调色（派生，不用 state）
  const accent =
    (currentId === null
      ? defaultTheme?.theme_accent
      : themes.find((x) => x.admin_id === currentId)?.theme_accent) ||
    defaultTheme?.theme_accent ||
    "#7c5cff";

  const pick = useCallback(
    (theme: ThemeLike | null) => {
      setOpen(false);
      if (!theme) {
        // 回到默认主题：清掉覆盖，交给 SiteConfigLoader 再写一遍
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

  // 没有可选主题时整块隐藏（只有默认主题，切换没意义）
  if (themes.length === 0) return null;

  const RADIUS = 96;
  const START_DEG = 200;
  const END_DEG = 268;
  const total = themes.length + 1; // 含"默认主题"
  const pos = (i: number) => {
    const deg =
      total <= 1 ? START_DEG : START_DEG + ((END_DEG - START_DEG) * i) / (total - 1);
    const rad = (deg * Math.PI) / 180;
    return { x: Math.cos(rad) * RADIUS, y: Math.sin(rad) * RADIUS };
  };

  return (
    <>
      {open && (
        <button
          type="button"
          className="theme-sw__scrim"
          aria-label="关闭主题菜单"
          onClick={() => setOpen(false)}
        />
      )}

      <div className={`theme-sw ${open ? "theme-sw--open" : ""}`}>
        <div className="theme-sw__ring" role="menu" aria-hidden={!open}>
          {/* 默认主题 */}
          <button
            type="button"
            role="menuitem"
            tabIndex={open ? 0 : -1}
            className={`theme-sw__item ${currentId === null ? "is-active" : ""}`}
            style={
              {
                "--sw-x": `${pos(0).x}px`,
                "--sw-y": `${pos(0).y}px`,
                "--sw-delay": "0ms",
                "--sw-dot": defaultTheme?.theme_accent || "#7c5cff",
              } as React.CSSProperties
            }
            onClick={() => pick(null)}
          >
            <span className="theme-sw__dot" />
            <span className="theme-sw__label">默认主题</span>
          </button>

          {themes.map((t, i) => (
            <button
              key={t.admin_id}
              type="button"
              role="menuitem"
              tabIndex={open ? 0 : -1}
              className={`theme-sw__item ${currentId === t.admin_id ? "is-active" : ""}`}
              style={
                {
                  "--sw-x": `${pos(i + 1).x}px`,
                  "--sw-y": `${pos(i + 1).y}px`,
                  "--sw-delay": `${(i + 1) * 45}ms`,
                  "--sw-dot": t.theme_accent || "#7c5cff",
                } as React.CSSProperties
              }
              onClick={() => pick(t)}
            >
              <span className="theme-sw__dot" />
              <span className="theme-sw__label">
                {t.name || t.owner_name}
              </span>
            </button>
          ))}
        </div>

        <button
          type="button"
          className="theme-sw__main"
          style={{ "--sw-accent": accent } as React.CSSProperties}
          aria-label={open ? "关闭主题菜单" : "切换主题"}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <MorphIcon icon={X} size={16} /> : <MorphIcon icon={Palette} size={16} />}
        </button>
      </div>
    </>
  );
}
