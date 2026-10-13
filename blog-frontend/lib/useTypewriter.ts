"use client";

import { useEffect, useState } from "react";

import {
  alignSnapshot,
  initialSnapshot,
  isTypingCursorVisible,
  nextSnapshot,
  type TypewriterOptions,
  type TypewriterSnapshot,
} from "./typewriter-core";

export type { TypewriterOptions } from "./typewriter-core";

export interface TypewriterState {
  /** 当前应显示的文本 */
  text: string;
  /** 是否显示光标 */
  typing: boolean;
}

/**
 * 打字机动画：打字 → 停顿 → 逐字删除 → 停顿 → 再打（循环）。
 *
 * 时序逻辑全在 typewriter-core 的纯函数里（有单测覆盖），
 * 这里只负责用 setTimeout 驱动它。
 *
 * 注意：每次只安排一个定时器，下一步都基于**当前 state** 计算，
 * 因此不会像旧实现那样因为读到过期闭包值而跳过删除阶段。
 */
export function useTypewriter(
  text: string,
  options: TypewriterOptions = {}
): TypewriterState {
  const [snap, setSnap] = useState<TypewriterSnapshot>(() =>
    initialSnapshot(text)
  );

  // 文本变化时对齐（shown 归零，从头打）
  const current = alignSnapshot(snap, text);
  const { typeSpeed, deleteSpeed, holdAfterType, holdAfterDelete, loop } =
    options;

  useEffect(() => {
    const step = nextSnapshot(current, text, {
      typeSpeed,
      deleteSpeed,
      holdAfterType,
      holdAfterDelete,
      loop,
    });

    if (!step.continues) return;

    const timer = setTimeout(() => setSnap(step.next), step.delay);
    return () => clearTimeout(timer);
    // current 由 snap + text 派生；逐项列出原始依赖避免对象身份变化导致重跑
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    current.shown,
    current.phase,
    text,
    typeSpeed,
    deleteSpeed,
    holdAfterType,
    holdAfterDelete,
    loop,
  ]);

  return {
    text: current.shown,
    typing: isTypingCursorVisible(current),
  };
}
