"use client";

import { useState } from "react";
import Link from "next/link";

import PlayerControls from "@/components/player/PlayerControls";
import PlayerProgress from "@/components/player/PlayerProgress";
import { usePlayer } from "@/components/player/PlayerProvider";
import { getCoverUrl } from "@/lib/types";

export default function MusicCard() {
  const { currentSong, isPlaying } = usePlayer();

  // 记录"加载封面失败的是哪首歌"，而不是一个布尔值。
  // 这样切歌时比较结果自然变成 false，不需要"切歌就重置"的 effect。
  const songKey = `${currentSong?.source ?? ""}-${currentSong?.id ?? ""}`;
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const coverError = errorKey === songKey;

  if (!currentSong) {
    return (
      <div className="glass music-card music-card--empty p-6 h-full">
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
  const coverSrc = getCoverUrl(currentSong);

  return (
    <div className="glass music-card mp-theme p-5 flex flex-col h-full relative overflow-hidden">
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

      {/* 与音乐页完全相同的进度条与控制键 */}
      <PlayerProgress />
      <PlayerControls />

      <div className="mt-auto pt-3 flex justify-end">
        <Link
          href="/music"
          className="text-xs hover:opacity-70 transition-opacity"
          style={{ color: "var(--text-secondary)" }}
        >
          查看全部 →
        </Link>
      </div>
    </div>
  );
}
