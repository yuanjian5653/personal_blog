"use client";

import { useEffect, useState } from "react";
import { MorphIcon } from "morphicons/react";
import { Info, X } from "lucide";

import { resolveImageUrl } from "@/lib/url";

/**
 * 关于页的切换器（浮动弧形展开）
 *
 * 原来是一排横向胶囊按钮。改成浮动按钮后：
 *   · 页面顶部不再被一排按钮占掉，正文从更靠上的位置开始
 *   · 切换项多起来也不会把标题挤下去
 *   · 主按钮直接显示"当前看的是谁"，一眼知道自己在哪一栏
 *
 * 位置固定在右下角，选项沿**左上方**的弧线展开（贴着屏幕边不会溢出）。
 *
 * 为什么没用 motion / framer-motion：
 *   项目里所有动画都是 CSS transition / keyframes，没有动画库。
 *   这里的位移用 transform + CSS 变量就能做，走合成层、也不额外加依赖。
 */
export interface FabOption {
  key: string;
  name: string;
  avatar: string | null;
}

export default function AboutFab({
  options,
  current,
  onSelect,
}: {
  options: FabOption[];
  current: string;
  onSelect: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const active = options.find((o) => o.key === current) ?? options[0];

  // Esc 关闭：浮动面板没有遮罩时，键盘用户没法退出
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // 弧线参数：半径固定，角度从"偏左"扫到"正上"
  const RADIUS = 104;
  const START_DEG = 188;
  const END_DEG = 272;
  const n = options.length;

  const pos = (i: number) => {
    const deg =
      n <= 1 ? START_DEG : START_DEG + ((END_DEG - START_DEG) * i) / (n - 1);
    const rad = (deg * Math.PI) / 180;
    return {
      x: Math.cos(rad) * RADIUS,
      // 屏幕坐标 y 向下为正，sin 为负表示往上
      y: Math.sin(rad) * RADIUS,
    };
  };

  return (
    <>
      {/* 点空白处收起（透明遮罩，不挡内容滚动时会自己关掉） */}
      {open && (
        <button
          type="button"
          className="about-fab__scrim"
          aria-label="关闭切换菜单"
          onClick={() => setOpen(false)}
        />
      )}

      <div className={`about-fab ${open ? "about-fab--open" : ""}`}>
        <div className="about-fab__ring" role="menu" aria-hidden={!open}>
          {options.map((o, i) => {
            const { x, y } = pos(i);
            const isActive = o.key === current;
            return (
              <button
                key={o.key}
                type="button"
                role="menuitem"
                tabIndex={open ? 0 : -1}
                aria-current={isActive ? "true" : undefined}
                className={`about-fab__item ${isActive ? "is-active" : ""}`}
                style={
                  {
                    "--fab-x": `${x}px`,
                    "--fab-y": `${y}px`,
                    "--fab-delay": `${i * 45}ms`,
                  } as React.CSSProperties
                }
                onClick={() => {
                  onSelect(o.key);
                  setOpen(false);
                }}
              >
                <span className="about-fab__avatar">
                  {o.avatar ? (
                    <img
                      src={resolveImageUrl(o.avatar) ?? ""}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <MorphIcon icon={Info} size={16} />
                  )}
                </span>
                <span className="about-fab__label">{o.name}</span>
              </button>
            );
          })}
        </div>

        <button
          type="button"
          className="about-fab__main"
          aria-label={open ? "关闭切换菜单" : `切换内容（当前：${active?.name ?? ""}）`}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span className="about-fab__main-inner">
            {open ? (
              <MorphIcon icon={X} size={20} />
            ) : active?.avatar ? (
              <img
                src={resolveImageUrl(active.avatar) ?? ""}
                alt=""
                className="h-full w-full rounded-full object-cover"
              />
            ) : (
              <MorphIcon icon={Info} size={20} />
            )}
          </span>
        </button>
      </div>
    </>
  );
}
