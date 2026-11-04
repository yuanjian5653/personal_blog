"use client";

import PlayerControls from "@/components/player/PlayerControls";
import PlayerProgress from "@/components/player/PlayerProgress";

/**
 * 音乐页底部控制条：进度 + 五个圆形控制键。
 *
 * 进度条和控制键都来自 components/player 下的共享组件，
 * 首页音乐卡片用的是同一对组件 —— 两处外观与交互天然一致。
 */
export default function MusicTransport() {
  return (
    <section className="mp-panel mp-transport">
      <PlayerProgress />
      <PlayerControls />
    </section>
  );
}
