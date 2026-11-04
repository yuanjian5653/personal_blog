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

import { usePlayer } from "@/components/player/PlayerProvider";
import { formatTime } from "@/lib/format";

/**
 * 底部控制条：进度 + 时间 + 五个圆形按钮。
 *
 * 播放器目前支持三种模式（order 顺序 / loop 列表循环 / single 单曲循环），
 * 没有随机，所以左端按钮做成"当前模式"的切换键而不是 shuffle：
 * 点一下在 顺序 → 列表循环 → 单曲循环 之间轮转。
 */
export default function MusicTransport() {
  const {
    currentSong,
    isPlaying,
    currentTime,
    duration,
    volume,
    playMode,
    toggle,
    next,
    prev,
    seek,
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

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const ModeIcon =
    playMode === "single" ? Repeat1 : playMode === "loop" ? Repeat : Shuffle;
  const modeLabel =
    playMode === "single"
      ? "单曲循环"
      : playMode === "loop"
        ? "列表循环"
        : "顺序播放";

  return (
    <section className="mp-panel mp-transport">
      <div className="mp-progress">
        <span className="mp-progress__time">{formatTime(currentTime)}</span>
        <div className="mp-progress__track">
          <div
            className="mp-progress__fill"
            style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
          />
          <input
            className="mp-progress__input"
            type="range"
            min={0}
            max={duration || 0}
            step={0.5}
            value={Math.min(currentTime, duration || 0)}
            aria-label="播放进度"
            onChange={(e) => seek(Number(e.target.value))}
          />
        </div>
        <span className="mp-progress__time mp-progress__time--right">
          {formatTime(duration)}
        </span>
      </div>

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
    </section>
  );
}
