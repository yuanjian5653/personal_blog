"use client";

import { useEffect, useState } from "react";

/**
 * 客户端挂载标记。
 *
 * 用途：某些 UI（主题开关的当前值、依赖 document.body 的弹窗/灯箱）
 * 在 SSR 阶段拿不到浏览器状态，直接渲染会导致 hydration 不一致。
 * 标准做法是先渲染占位，挂载后再渲染真实内容。
 *
 * 为什么这里要关掉 react-hooks/set-state-in-effect：
 * 那个规则针对的是"用 effect 同步派生数据"。而本 hook 的 setState
 * 是**刻意的**一次性挂载信号——它依赖的正是"尚未挂载"这个事实，
 * 不能在渲染期求值，也没有其他非 effect 的实现方式。
 * 把豁免集中在这里，调用方就不必各自写 eslint-disable。
 */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 见上方说明：刻意的挂载信号
    setMounted(true);
  }, []);

  return mounted;
}
