"use client";

import { useEffect, useState } from "react";

import { useMounted } from "@/lib/useMounted";

const STORAGE_KEY = "card_style_override";

/**
 * 昼夜切换开关
 * - 默认读取 `document.documentElement.dataset.cardStyle`（由 SiteConfigLoader 设置）
 * - 切换时更新 DOM 属性 + localStorage
 * - 刷新后 SiteConfigLoader 会读取 localStorage 覆盖默认值
 */
export default function ThemeToggle() {
  const mounted = useMounted();
  // 初始值直接取自 DOM：isDark 只在客户端有意义，由 handleToggle 维护
  const [isDark, setIsDark] = useState(false);

  // 挂载后把 DOM 上的真实状态同步到 isDark。
  // 这里不能用惰性初始化，因为服务端没有 document，会破坏 hydration。
  useEffect(() => {
    const current = document.documentElement.dataset.cardStyle || "glass";
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 读取浏览器状态，无法在渲染期求值
    setIsDark(current === "black");
  }, []);

  const handleToggle = () => {
    const next = isDark ? "glass" : "black";
    setIsDark(!isDark);
    document.documentElement.dataset.cardStyle = next;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {}
  };

  // SSR 阶段渲染占位，避免闪烁
  if (!mounted) {
    return (
      <span
        className="theme-switch"
        style={{ visibility: "hidden" }}
        aria-hidden="true"
      />
    );
  }

  return (
    <label
      className="theme-switch"
      role="switch"
      aria-checked={isDark}
      title={isDark ? "切换到原版毛玻璃" : "切换到黑色毛玻璃"}
    >
      <input type="checkbox" checked={isDark} onChange={handleToggle} />
      <span className="slider">
        <span className="slider-inner" />
      </span>
    </label>
  );
}