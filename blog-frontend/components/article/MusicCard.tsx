"use client";

import { useEffect, useState } from "react";
import { MorphIcon } from "morphicons/react";
import { Music, Play, Pause, SkipBack, SkipForward } from "lucide";
import { usePlayer } from "@/components/player/PlayerProvider";
import { parseLrc, findActiveLyricIndex, type LyricLine } from "@/lib/lrc";
import { getCoverUrl, getLyricUrl } from "@/lib/types";

/** 歌曲唯一标识：切歌时要能区分"这份歌词属于哪首歌" */
function songKey(song: { id: number; source?: string }): string {
  return `${song.source ?? "local"}-${song.id}`;
}

export default function MusicCard({ loading = false }: { loading?: boolean }) {
  const { currentSong, isPlaying, currentTime, toggle, next, prev } =
    usePlayer();
  // 把"歌词内容"和"它属于哪首歌"一起存下来。
  // 这样切歌时不用 setLyrics([]) 清空，旧歌词自然不会显示（key 对不上）。
  const [lyricsData, setLyricsData] = useState<{
    key: string;
    lines: LyricLine[];
  } | null>(null);

  const key = currentSong ? songKey(currentSong) : null;
  const lyrics = key && lyricsData?.key === key ? lyricsData.lines : [];

  useEffect(() => {
    if (!currentSong) return;
    const k = songKey(currentSong);
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

  const activeLyricIdx = findActiveLyricIndex(lyrics, currentTime);
  const activeLyricText =
    activeLyricIdx >= 0 ? lyrics[activeLyricIdx].text : "♪";

  return (
    <div className="side-card side-music">
      {loading ? (
        /* 骨架 */
        <div className="sk-music">
          <div className="sk-line w-30" />
          <div className="sk-music-track">
            <div className="sk-rect" />
            <div className="sk-music-track-lines">
              <div className="sk-line w-70" />
              <div className="sk-line w-50" />
            </div>
          </div>
          <div className="sk-music-lyric" />
          <div className="sk-music-controls">
            <div className="sk-circle" />
            <div className="sk-circle" />
            <div className="sk-circle" />
          </div>
        </div>
      ) : (
        /* 真实内容 */
        <>
          <div className="side-music-header">
            <MorphIcon icon={Music}
                       size={14}
                       style={{ color: "var(--accent)" }}
            />
            <span>Now Playing</span>
          </div>

          <div className="side-music-track">
            <div className="side-music-cover">
              {currentSong &&
              (currentSong.cover_url || currentSong.cover_path) ? (
                <img
                  src={getCoverUrl(currentSong)}
                  alt=""
                  onError={(e) =>
                    ((e.target as HTMLImageElement).style.display = "none")
                  }
                />
              ) : (
                "♪"
              )}
            </div>
            <div className="side-music-info">
              <div className="side-music-title">
                {currentSong?.title || "暂无播放"}
              </div>
              <div className="side-music-artist">
                {currentSong?.artist || "点击播放按钮开始"}
              </div>
            </div>
          </div>

          <div className="side-music-lyric">
            <span className="side-music-lyric-text active">
              {currentSong
                ? lyrics.length > 0
                  ? activeLyricText
                  : "♪ 纯音乐，请欣赏"
                : "♪ 等待播放"}
            </span>
          </div>

          <div className="side-music-controls">
            <button
              className="side-music-btn"
              onClick={prev}
              disabled={!currentSong}
              title="上一首"
            >
              <MorphIcon icon={SkipBack} size={12} />
            </button>
            <button
              className="side-music-btn play"
              onClick={toggle}
              disabled={!currentSong}
              title={isPlaying ? "暂停" : "播放"}
            >
              <MorphIcon icon={isPlaying ? Pause : Play} size={12} />
            </button>
            <button
              className="side-music-btn"
              onClick={next}
              disabled={!currentSong}
              title="下一首"
            >
              <MorphIcon icon={SkipForward} size={12} />
            </button>
          </div>
        </>
      )}
    </div>
  );
}