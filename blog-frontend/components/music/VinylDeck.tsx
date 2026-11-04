"use client";

import { Volume2 } from "lucide";
import { MorphIcon } from "morphicons/react";

import type { Song } from "@/lib/types";
import CoverArt from "./CoverArt";

interface Props {
  song: Song | null;
  playing: boolean;
  volume: number;
  onVolumeChange: (v: number) => void;
}

/**
 * 左侧「唱片机」：旋转黑胶 + 唱臂 + 曲目信息 + 音量。
 *
 * 两个物理感的小细节：
 *   · 唱片只在播放时转，暂停就停在当前角度（用 animation-play-state，
 *     不用 JS 定时器，恢复播放不会跳一下）
 *   · 唱臂会随播放状态摆动：暂停时抬离唱片，播放时落到唱片上
 *     （.mp-deck.is-playing 控制，CSS 过渡回弹）
 */
export default function VinylDeck({
  song,
  playing,
  volume,
  onVolumeChange,
}: Props) {
  return (
    <div className={`mp-deck${playing ? " is-playing" : ""}`}>
      <div className="mp-vinyl-stage">
        <div className={`mp-vinyl${playing ? " is-spinning" : ""}`}>
          <div className="mp-vinyl__label">
            <CoverArt
              song={song}
              fallback={<span aria-hidden="true">♪</span>}
              alt={song?.title ?? ""}
            />
            <span className="mp-vinyl__hole" />
          </div>
        </div>
        <span className="mp-tonearm" aria-hidden="true" />
      </div>

      <div className="mp-meta">
        {song ? (
          <>
            <h2 className="mp-meta__title" title={song.title}>
              {song.title}
            </h2>
            <p className="mp-meta__artist" title={song.artist}>
              {song.artist}
            </p>
          </>
        ) : (
          <p className="mp-meta__empty">选一首歌开始播放</p>
        )}
      </div>

      <div className="mp-volume">
        <span className="mp-volume__icon" aria-hidden="true">
          <MorphIcon icon={Volume2} size={15} />
        </span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          aria-label="音量"
          onChange={(e) => onVolumeChange(Number(e.target.value))}
        />
      </div>
    </div>
  );
}
