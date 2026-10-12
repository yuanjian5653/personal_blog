"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePlayer } from "@/components/player/PlayerProvider";
import { formatTime } from "@/lib/format";
import { getCoverUrl } from "@/lib/types";

export default function MusicCard() {
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

  // 记录"加载封面失败的是哪首歌"，而不是一个布尔值。
  // 这样切歌时比较结果自然变成 false，不需要"切歌就重置"的 effect。
  const songKey = `${currentSong?.source ?? ""}-${currentSong?.id ?? ""}`;
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const coverError = errorKey === songKey;

  if (!currentSong) {
    return (
      <div className="glass p-6 flex flex-col items-center justify-center h-full text-center">
        <div
          className="w-20 h-20 rounded-full mb-4 flex items-center justify-center"
          style={{ background: "rgba(255,255,255,0.05)" }}
        >
          <span className="text-2xl">🎵</span>
        </div>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          点击音乐页开始播放
        </p>
        <Link
          href="/music"
          className="mt-3 text-xs px-4 py-1.5 rounded-full"
          style={{ background: "var(--accent)", color: "#fff" }}
        >
          去音乐页
        </Link>
      </div>
    );
  }

  // 封面判断：网易云用 cover_url，本地用 cover_path
  const hasCover =
    (!!currentSong.cover_url || !!currentSong.cover_path) && !coverError;

  // 封面 URL
  const coverSrc = getCoverUrl(currentSong);

  const cycleMode = () => {
    const order: Array<"order" | "loop" | "single"> = ["order", "loop", "single"];
    const idx = order.indexOf(playMode);
    setPlayMode(order[(idx + 1) % order.length]);
  };

  const modeIcon = { order: "↻", loop: "🔀", single: "🔂" }[playMode];

  return (
    <div className="glass p-5 flex flex-col h-full relative overflow-hidden">
      <div className="flex items-center justify-between mb-4">
        <span
          className="text-xs uppercase tracking-widest"
          style={{ color: "var(--text-secondary)" }}
        >
          Music
        </span>
        <svg viewBox="0 0 16 16" width="16" height="16" fill="var(--accent)">
          <path d="M9 13c0 1.105-1.12 2-2.5 2S4 14.105 4 13s1.12-2 2.5-2 2.5.895 2.5 2z" />
          <path d="M9 3v10H8V3h1z" fillRule="evenodd" />
          <path d="M8 2.82a1 1 0 0 1 .804-.98l3-.6A1 1 0 0 1 13 2.22V4L8 5V2.82z" />
        </svg>
      </div>

      <div className="flex items-center gap-4 mb-4">
        <div className="relative w-16 h-16 flex-shrink-0">
          {hasCover ? (
            <Link
              href="/music"
              className="block w-16 h-16 rounded-lg overflow-hidden bg-white/5 hover:opacity-80 transition-opacity"
            >
              <img
                key={`${currentSong.source}-${currentSong.id}`}
                src={coverSrc}
                alt={currentSong.title}
                className="w-full h-full object-cover"
                referrerPolicy="no-referrer"
                onError={() => setErrorKey(songKey)}
              />
            </Link>
          ) : (
            <Link href="/music" className="block">
              <div
                className={`disc w-16 h-16 ${
                  isPlaying ? "disc-spin" : "disc-paused"
                }`}
              >
                <div
                  className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold"
                  style={{ background: "var(--accent)", color: "#fff" }}
                >
                  ♪
                </div>
              </div>
            </Link>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <Link
            href="/music"
            className="text-sm font-semibold truncate block hover:text-[var(--accent)] transition-colors"
          >
            {currentSong.title}
          </Link>
          <p
            className="text-xs truncate mt-0.5"
            style={{ color: "var(--text-secondary)" }}
          >
            {currentSong.artist}
          </p>
        </div>
      </div>

      <div className="mb-3">
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={currentTime}
          onChange={(e) => seek(Number(e.target.value))}
          className="w-full h-1 accent-[var(--accent)] cursor-pointer"
        />
        <div
          className="flex justify-between text-[10px] mt-1"
          style={{ color: "var(--text-secondary)" }}
        >
          <span className="tabular-nums">{formatTime(currentTime)}</span>
          <span className="tabular-nums">{formatTime(duration)}</span>
        </div>
      </div>

      <div className="flex items-center justify-center gap-4 mb-3">
        <button
          onClick={prev}
          className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-white/10"
          title="上一首"
        >
          ⏮
        </button>

        <button
          onClick={toggle}
          className="w-11 h-11 rounded-full flex items-center justify-center text-white"
          style={{ background: "var(--accent)" }}
          title={isPlaying ? "暂停" : "播放"}
        >
          {isPlaying ? "⏸" : "▶"}
        </button>

        <button
          onClick={next}
          className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-white/10"
          title="下一首"
        >
          ⏭
        </button>
      </div>

      <div
        className="flex items-center justify-between text-xs pt-3"
        style={{
          borderTop: "1px solid rgba(255,255,255,0.06)",
          color: "var(--text-secondary)",
        }}
      >
        <button onClick={cycleMode} className="hover:opacity-70" title="播放模式">
          {modeIcon}
        </button>
        <Link href="/music" className="hover:opacity-70" title="音乐库">
          ☰
        </Link>
        <button className="hover:opacity-70" title="喜欢">
          ♡
        </button>
        <div className="flex items-center gap-1">
          <span>🔊</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={(e) => setVolume(Number(e.target.value))}
            className="w-14 h-1 accent-[var(--accent)] cursor-pointer"
          />
        </div>
        <Link href="/music" className="hover:opacity-70" title="查看全部">
          →
        </Link>
      </div>
    </div>
  );
}