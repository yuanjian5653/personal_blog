"use client";

import { useSyncExternalStore } from "react";

import {
  getEggsServerSnapshot,
  getEggsSnapshot,
  subscribeEggs,
} from "@/lib/easterEggs";
import StarField from "@/components/effects/StarField";

/**
 * 彩蛋宿主：挂在根布局里，负责把"已解锁的效果"渲染成实际画面。
 *
 * 为什么单独抽一层：
 *   搜索框只负责"输入暗号 → 改状态"，实际效果必须挂在布局上才能覆盖全站。
 *   两者通过 localStorage + 自定义事件通信，互不依赖。
 *
 * 为什么用 useSyncExternalStore 而不是 useEffect + setState：
 *   localStorage 本身就是"外部数据源"，用这个 hook 既符合语义，
 *   也不会触发 react-hooks/set-state-in-effect（同步 setState 会多一轮渲染）。
 */
export default function EasterEggHost() {
  const active = useSyncExternalStore(
    subscribeEggs,
    getEggsSnapshot,
    getEggsServerSnapshot
  );

  if (active.length === 0) return null;

  return (
    <>
      {active.includes("stars") && <StarField />}
      {/* 以后的彩蛋效果在这里加一行即可 */}
    </>
  );
}
