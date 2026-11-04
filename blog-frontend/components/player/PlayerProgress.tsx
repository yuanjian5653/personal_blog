"use client";

import { formatTime } from "@/lib/format";
import { usePlayer } from "./PlayerProvider";

/**
 * 播放进度条（当前时间 / 可拖动轨道 / 总时长）。
 *
 * 与 PlayerControls 一样，首页音乐卡片和音乐页控制条共用，
 * 保证两处外观与手感一致。样式见 .mp-progress（music-page.css），
 * 使用方需要在祖先上带 .mp-theme 或 .music-page 提供 --mp-* 变量。
 */
export default function PlayerProgress() {
  const { currentTime, duration, seek } = usePlayer();

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const clamped = Math.min(100, Math.max(0, progress));

  return (
    <div className="mp-progress">
      <span className="mp-progress__time">{formatTime(currentTime)}</span>
      <div className="mp-progress__track">
        <div className="mp-progress__fill" style={{ width: `${clamped}%` }} />
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
  );
}
