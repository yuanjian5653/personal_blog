"use client";

import { useEffect, useState } from "react";

import { api } from "@/lib/api";
import { getCoverUrl, type Song } from "@/lib/types";
import { usePlayer } from "@/components/player/PlayerProvider";
import { formatTime } from "@/lib/format";
import SkeletonLoader from "@/components/ui/SkeletonLoader";

/** 标签 1：本地音乐列表 */
export default function LocalTab() {
  // null = 尚未加载完；loading 由它派生，避免在 effect 里同步 setState
  const [songs, setSongs] = useState<Song[] | null>(null);
  const loading = songs === null;
  const [keyword, setKeyword] = useState("");
  const { play, currentSong, isPlaying, toggle, addSongsToQueue } = usePlayer();

  useEffect(() => {
    let cancelled = false;
    api
      .get<Song[]>("/api/music/songs")
      .then((data) => {
        if (cancelled) return;
        setSongs(data.map((s) => ({ ...s, source: "local" as const })));
      })
      .catch(() => {
        if (!cancelled) setSongs([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const allSongs = songs ?? [];
  const filtered = keyword
    ? allSongs.filter(
        (s) =>
          s.title.toLowerCase().includes(keyword.toLowerCase()) ||
          s.artist.toLowerCase().includes(keyword.toLowerCase())
      )
    : allSongs;

  const handlePlay = (song: Song) => {
    if (currentSong?.id === song.id && currentSong?.source === song.source) {
      toggle();
      return;
    }
    play(song, filtered);
  };

  if (loading) return <SkeletonLoader lines={4} />;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <input
          type="text"
          placeholder="搜索本地歌曲..."
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          className="flex-1 h-10 px-4 rounded-lg bg-white/5 border border-white/10 focus:border-[var(--accent)] outline-none text-sm"
        />
        <button
          onClick={() => addSongsToQueue(filtered)}
          className="px-4 h-10 rounded-lg text-sm whitespace-nowrap"
          style={{ background: "var(--accent)", color: "#fff" }}
        >
          + 全部加入播放列表
        </button>
      </div>

      {filtered.length === 0 ? (
        <div
          className="glass p-12 text-center text-sm"
          style={{ color: "var(--text-secondary)" }}
        >
          {allSongs.length === 0 ? "本地还没有音乐" : "没有匹配的歌曲"}
        </div>
      ) : (
        <div className="glass p-2">
          {filtered.map((song, i) => {
            const isCurrent =
              currentSong?.id === song.id && currentSong?.source === song.source;
            return (
              <button
                key={song.id}
                onClick={() => handlePlay(song)}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/5 transition-colors text-left"
              >
                <span
                  className="w-6 text-center text-xs tabular-nums"
                  style={{
                    color: isCurrent ? "var(--accent)" : "var(--text-secondary)",
                  }}
                >
                  {isCurrent && isPlaying ? "♪" : String(i + 1).padStart(2, "0")}
                </span>

                <img
                  src={getCoverUrl(song)}
                  alt=""
                  className="w-10 h-10 rounded object-cover bg-white/5 flex-shrink-0"
                  onError={(e) =>
                    ((e.target as HTMLImageElement).style.visibility = "hidden")
                  }
                />

                <div className="flex-1 min-w-0">
                  <div
                    className="text-sm truncate"
                    style={{
                      color: isCurrent ? "var(--accent)" : "var(--text-primary)",
                    }}
                  >
                    {song.title}
                  </div>
                  <div
                    className="text-xs truncate"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    {song.artist}
                  </div>
                </div>

                <span
                  className="text-xs tabular-nums"
                  style={{ color: "var(--text-secondary)" }}
                >
                  {formatTime(song.duration)}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
