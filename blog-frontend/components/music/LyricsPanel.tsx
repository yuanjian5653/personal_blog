"use client";

import { useEffect, useState } from "react";

import { usePlayer } from "@/components/player/PlayerProvider";
import { findActiveLyricIndex, parseLrc, type LyricLine } from "@/lib/lrc";
import { getLyricUrl } from "@/lib/types";

/**
 * 模块级歌词缓存。
 * 切到别的页面再回音乐页时组件会重新挂载，没有这层缓存就会重新请求一遍歌词。
 * key 用 "来源-id"，同一首歌永远命中。
 */
const lyricCache = new Map<string, LyricLine[]>();
/** 进行中的请求，避免同一首歌并发拉两次 */
const inflight = new Map<string, Promise<LyricLine[]>>();

function loadLyrics(key: string, url: string): Promise<LyricLine[]> {
  const cached = lyricCache.get(key);
  if (cached) return Promise.resolve(cached);

  const running = inflight.get(key);
  if (running) return running;

  const p = fetch(url)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error("no lyric"))))
    .then((d: { content?: string; lyric?: string }) => {
      const raw = d.content || d.lyric || "";
      const lines = raw.trim() ? parseLrc(raw) : [];
      lyricCache.set(key, lines);
      return lines;
    })
    .catch(() => {
      // 「没有歌词」也缓存，避免每次切歌都白请求一遍
      lyricCache.set(key, []);
      return [] as LyricLine[];
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, p);
  return p;
}

/**
 * 歌词面板：居中滚动 + 高亮当前行。
 *
 * 逻辑与原来的 LyricsTab 一致（同一套 parseLrc / findActiveLyricIndex），
 * 只是换了外观、收进面板里，并加了模块级缓存。
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

    loadLyrics(key, getLyricUrl(currentSong)).then((lines) => {
      if (!cancelled) setData({ key, lines });
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
