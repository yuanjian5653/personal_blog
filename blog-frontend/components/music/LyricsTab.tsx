"use client";

import { useEffect, useState } from "react";

import { getLyricUrl } from "@/lib/types";
import { usePlayer } from "@/components/player/PlayerProvider";
import { parseLrc, findActiveLyricIndex, type LyricLine } from "@/lib/lrc";

/** 标签 4：歌词（自动滚动 + 居中高亮） */
export default function LyricsTab() {
  const { currentSong, currentTime } = usePlayer();
  // 歌词与"属于哪首歌"一起存，切歌时无需清空
  const [lyricsData, setLyricsData] = useState<{
    key: string;
    lines: LyricLine[];
  } | null>(null);

  const lyricsKey = currentSong
    ? `${currentSong.source ?? "local"}-${currentSong.id}`
    : null;
  const lyrics =
    lyricsKey && lyricsData?.key === lyricsKey ? lyricsData.lines : [];

  useEffect(() => {
    if (!currentSong) return;
    const k = `${currentSong.source ?? "local"}-${currentSong.id}`;
    let cancelled = false;

    fetch(getLyricUrl(currentSong))
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { content?: string; lyric?: string }) => {
        if (cancelled) return;
        const raw = d.content || d.lyric || "";
        setLyricsData({ key: k, lines: raw.trim() ? parseLrc(raw) : [] });
      })
      .catch(() => {
        if (!cancelled) setLyricsData({ key: k, lines: [] });
      });

    return () => {
      cancelled = true;
    };
  }, [currentSong]);

  const activeIndex = findActiveLyricIndex(lyrics, currentTime);

  if (!currentSong) {
    return (
      <div
        className="glass p-12 text-center text-sm"
        style={{ color: "var(--text-secondary)" }}
      >
        还没有播放任何歌曲
      </div>
    );
  }

  if (lyrics.length === 0) {
    return (
      <div
        className="glass p-12 text-center text-sm"
        style={{ color: "var(--text-secondary)" }}
      >
        这首歌没有歌词
      </div>
    );
  }

  return (
    <div
      className="glass relative overflow-hidden"
      style={{
        height: "500px",
        background: "rgba(18,20,28,0.9)",
        border: "1px solid rgba(255,255,255,0.08)",
      }}
    >
      {/* 歌词滚动区 */}
      <div className="absolute inset-0 overflow-hidden">
        <div
          className="absolute inset-x-0 transition-transform duration-500 ease-out"
          style={{
            top: "50%",
            transform: `translateY(${
              -(activeIndex >= 0 ? activeIndex : 0) * 60 - 30
            }px)`,
          }}
        >
          {lyrics.map((line, i) => {
            const isActive = i === activeIndex;
            const distance = Math.abs(
              i - (activeIndex >= 0 ? activeIndex : 0)
            );
            return (
              <div
                key={i}
                className="flex items-center justify-center text-center transition-all duration-300 px-4"
                style={{
                  height: "60px",
                  color: isActive
                    ? "var(--accent)"
                    : "rgba(232,232,234,0.7)",
                  fontWeight: isActive ? 700 : 500,
                  fontSize: isActive ? "1.35rem" : "1rem",
                  opacity: isActive ? 1 : Math.max(0.4, 1 - distance * 0.15),
                  textShadow: isActive
                    ? "0 0 20px var(--accent), 0 0 8px var(--accent)"
                    : "0 1px 3px rgba(0,0,0,0.7)",
                  letterSpacing: isActive ? "0.02em" : "0",
                }}
              >
                {line.text}
              </div>
            );
          })}
        </div>
      </div>

      {/* 顶部渐隐 */}
      <div
        className="absolute top-0 left-0 right-0 h-28 pointer-events-none"
        style={{
          background:
            "linear-gradient(to bottom, rgba(18,20,28,0.98), transparent)",
        }}
      />
      {/* 底部渐隐 */}
      <div
        className="absolute bottom-0 left-0 right-0 h-28 pointer-events-none"
        style={{
          background:
            "linear-gradient(to top, rgba(18,20,28,0.98), transparent)",
        }}
      />
    </div>
  );
}
