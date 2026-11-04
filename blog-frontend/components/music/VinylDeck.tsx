"use client";

import { Volume2 } from "lucide";
import { MorphIcon } from "morphicons/react";

import { getCoverUrl, type Song } from "@/lib/types";

interface Props {
  song: Song | null;
  playing: boolean;
  volume: number;
  onVolumeChange: (v: number) => void;
}

/**
 * 左侧「唱片机」：旋转黑胶 + 唱臂 + 曲目信息 + 音量。
 *
 * 唱片只在播放时转（animation-play-state 控制），暂停就停在当前角度，
 * 和真实唱机一致 —— 用 animation 而不是 JS 定时器，暂停恢复不会跳一下。
 */
export default function VinylDeck({
  song,
  playing,
  volume,
  onVolumeChange,
}: Props) {
  const cover = song ? getCoverUrl(song) : "";

  return (
    <div className="mp-deck">
      <div className="mp-vinyl-stage">
        <div className={`mp-vinyl${playing ? " is-spinning" : ""}`}>
          <div className="mp-vinyl__label">
            {cover ? (
              // eslint-disable-next-line @next/next/no-img-element -- 封面来自后端/外链，尺寸固定，无需 next/image
              <img src={cover} alt="" loading="lazy" />
            ) : (
              <span aria-hidden="true">♪</span>
            )}
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
