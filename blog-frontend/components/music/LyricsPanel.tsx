"use client";

import { useEffect, useState } from "react";

import { usePlayer } from "@/components/player/PlayerProvider";
import { findActiveLyricIndex, parseLrc, type LyricLine } from "@/lib/lrc";
import { getLyricUrl } from "@/lib/types";

/**
 * 歌词面板：居中滚动 + 高亮当前行（参考稿里高亮是粉色）。
 *
 * 逻辑与原来的 LyricsTab 一致（同一套 parseLrc / findActiveLyricIndex），
 * 只是换了外观并收进面板里。歌词按"属于哪首歌"缓存在一起，切歌时不会串。
 */
export default function LyricsPanel() {
  const { currentSong, currentTime } = usePlayer();
  const [data, setData] = useState<{ key: string; lines: LyricLine[] } | null>(
    null
  );

  const key = currentSong
    ? `${currentSong.source ?? "local"}-${currentSong.id}`
    : null;
  const lines = key && data?.key === key ? data.lines : [];

  useEffect(() => {
    if (!currentSong || !key) return;
    let cancelled = false;

    fetch(getLyricUrl(currentSong))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("no lyric"))))
      .then((d: { content?: string; lyric?: string }) => {
        if (cancelled) return;
        const raw = d.content || d.lyric || "";
        setData({ key, lines: raw.trim() ? parseLrc(raw) : [] });
      })
      .catch(() => {
        if (!cancelled) setData({ key, lines: [] });
      });

    return () => {
      cancelled = true;
    };
  }, [currentSong, key]);

  const activeIndex = findActiveLyricIndex(lines, currentTime);

  if (!currentSong) {
    return <div className="mp-lyrics__hint">还没有播放任何歌曲</div>;
  }
  if (lines.length === 0) {
    return <div className="mp-lyrics__hint">这首歌没有歌词</div>;
  }

  return (
    <div className="mp-lyrics">
      <div
        className="mp-lyrics__scroller"
        style={{
          transform: `translateY(${-(activeIndex >= 0 ? activeIndex : 0) * 46 - 23}px)`,
        }}
      >
        {lines.map((line, i) => (
          <div
            key={i}
            className={`mp-lyrics__line${i === activeIndex ? " is-active" : ""}`}
          >
            {line.text}
          </div>
        ))}
      </div>
    </div>
  );
}
