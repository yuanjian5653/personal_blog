"use client";

import { useEffect, useRef, useState } from "react";
import {
  ListMusic,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  VolumeX,
} from "lucide";
import { MorphIcon } from "morphicons/react";

import {
  cyclePlayMode,
  PLAY_MODE_LABEL,
  type PlayMode,
} from "@/lib/playback";
import { usePlayer } from "./PlayerProvider";

/**
 * 每种模式对应的图标。
 *
 * 注意顺序（之前这里是错的）：旧代码用 `single→Repeat1 / loop→Repeat /
 * order→Shuffle`，但"顺序播放"显示随机图标、而 loop 当时又真的是随机，
 * 结果图标和实际行为对不上。现在四种模式与图标一一对应。
 */
const MODE_ICON: Record<PlayMode, typeof Repeat> = {
  order: ListMusic,
  loop: Repeat,
  single: Repeat1,
  shuffle: Shuffle,
};

/**
 * 播放控制键（模式 / 上一首 / 播放暂停 / 下一首 / 静音）。
 *
 * 抽成独立组件，首页音乐卡片和音乐页控制条共用同一份 ——
 * 这样两处按钮的**外观和交互完全一致**，不会各写一套再慢慢走样。
 * 样式来自 app/styles/music-page.css 的 .mp-ctrl；
 * 使用方需要在祖先上带 .mp-theme（或用 .music-page）来提供 --mp-* 变量。
 */
export default function PlayerControls() {
  const {
    currentSong,
    isPlaying,
    volume,
    playMode,
    toggle,
    next,
    prev,
    setVolume,
    setPlayMode,
  } = usePlayer();

  // 静音前的音量，取消静音时恢复
  const lastVolume = useRef(volume > 0 ? volume : 0.8);
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    if (volume > 0) lastVolume.current = volume;
  }, [volume]);

  const toggleMute = () => {
    if (muted) {
      setVolume(lastVolume.current || 0.8);
      setMuted(false);
    } else {
      setVolume(0);
      setMuted(true);
    }
  };

  // 循环顺序与文案都来自 lib/playback.ts（与底栏 PlayerBar 共用同一份）
  const cycleMode = () => setPlayMode(cyclePlayMode(playMode));

  const ModeIcon = MODE_ICON[playMode];
  const modeLabel = PLAY_MODE_LABEL[playMode];

  return (
    <div className="mp-controls">
      <button
        type="button"
        className={`mp-ctrl${playMode !== "order" ? " is-on" : ""}`}
        onClick={cycleMode}
        title={modeLabel}
        aria-label={`播放模式：${modeLabel}（点击切换）`}
      >
        <MorphIcon icon={ModeIcon} size={16} />
      </button>

      <button
        type="button"
        className="mp-ctrl"
        onClick={prev}
        title="上一首"
        aria-label="上一首"
      >
        <MorphIcon icon={SkipBack} size={17} />
      </button>

      <button
        type="button"
        className="mp-ctrl mp-ctrl--play"
        onClick={toggle}
        title={isPlaying ? "暂停" : "播放"}
        aria-label={isPlaying ? "暂停" : "播放"}
        disabled={!currentSong}
      >
        <MorphIcon icon={isPlaying ? Pause : Play} size={19} />
      </button>

      <button
        type="button"
        className="mp-ctrl"
        onClick={next}
        title="下一首"
        aria-label="下一首"
      >
        <MorphIcon icon={SkipForward} size={17} />
      </button>

      <button
        type="button"
        className={`mp-ctrl${muted ? " is-on" : ""}`}
        onClick={toggleMute}
        title={muted ? "取消静音" : "静音"}
        aria-label={muted ? "取消静音" : "静音"}
      >
        <MorphIcon icon={VolumeX} size={16} />
      </button>
    </div>
  );
}
