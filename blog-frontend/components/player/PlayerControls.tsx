"use client";

import { useEffect, useRef, useState } from "react";
import {
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

import { usePlayer } from "./PlayerProvider";

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

  const cycleMode = () => {
    setPlayMode(
      playMode === "order" ? "loop" : playMode === "loop" ? "single" : "order"
    );
  };

  const ModeIcon =
    playMode === "single" ? Repeat1 : playMode === "loop" ? Repeat : Shuffle;
  const modeLabel =
    playMode === "single"
      ? "单曲循环"
      : playMode === "loop"
        ? "列表循环"
        : "顺序播放";

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
