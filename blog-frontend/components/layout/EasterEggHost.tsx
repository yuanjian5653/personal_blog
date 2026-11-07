"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

import {
  EGG_GAME_EVENT,
  getEggsServerSnapshot,
  getEggsSnapshot,
  subscribeEggs,
  type EggEffect,
} from "@/lib/easterEggs";
import BackgroundLayer from "@/components/effects/BackgroundLayer";
import CatchStars from "@/components/games/CatchStars";

/**
 * 彩蛋宿主：挂在根布局里，负责把"已解锁的效果"渲染成实际画面。
 *
 * 两类彩蛋走两条不同的路：
 *
 *   background / stars（背景类）
 *     存进 localStorage，用 useSyncExternalStore 订阅 → 常驻，刷新仍在。
 *
 *   game（游戏类）
 *     **不持久化**，解锁时由搜索框 dispatch 一个事件、这里接住后打开。
 *     理由：游戏是"一次性动作"而不是"常驻效果"，
 *     如果也存起来，用户每次刷新页面都会被弹一个游戏窗口。
 */
export default function EasterEggHost() {
  const active = useSyncExternalStore(
    subscribeEggs,
    getEggsSnapshot,
    getEggsServerSnapshot
  );

  const [game, setGame] = useState<EggEffect | null>(null);

  // 订阅"游戏类彩蛋被解锁"。setState 发生在事件回调里，
  // 不是 effect 体内同步调用 —— 符合项目的 lint 规则。
  useEffect(() => {
    const onGame = (ev: Event) => {
      const detail = (ev as CustomEvent<EggEffect>).detail;
      if (detail) setGame(detail);
    };
    window.addEventListener(EGG_GAME_EVENT, onGame);
    return () => window.removeEventListener(EGG_GAME_EVENT, onGame);
  }, []);

  // 只取最后一个背景类彩蛋（多个同时开时，后解锁的覆盖先解锁的）
  const bgEggs = active.filter(
    (e) => e.kind === "background" || e.kind === "stars"
  );
  const bgEgg = bgEggs.length ? bgEggs[bgEggs.length - 1] : null;

  return (
    <>
      {bgEgg && <BackgroundLayer key={bgEgg.egg_id} egg={bgEgg} />}
      {game && <CatchStars onClose={() => setGame(null)} />}
    </>
  );
}
