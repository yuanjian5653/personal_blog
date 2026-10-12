"use client";

import { getCoverUrl } from "@/lib/types";
import { usePlayer } from "@/components/player/PlayerProvider";
import { formatTime } from "@/lib/format";

/** 标签 3：播放列表（当前队列） */
export default function QueueTab() {
  const {
    playlist,
    currentIndex,
    isPlaying,
    playAt,
    removeFromQueue,
    clearQueue,
  } = usePlayer();

  if (playlist.length === 0) {
    return (
      <div
        className="glass p-12 text-center text-sm"
        style={{ color: "var(--text-secondary)" }}
      >
        播放列表为空，从「本地」或「网易云」添加歌曲
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm" style={{ color: "var(--text-secondary)" }}>
          共 {playlist.length} 首
        </span>
        <button
          onClick={clearQueue}
          className="text-xs px-3 py-1.5 rounded-lg"
          style={{ color: "#f87171", border: "1px solid rgba(248,113,113,0.3)" }}
        >
          清空列表
        </button>
      </div>

      <div className="glass p-2">
        {playlist.map((song, i) => {
          const isCurrent = i === currentIndex;
          const coverUrl = getCoverUrl(song);
          return (
            <div
              key={`${song.source}-${song.id}-${i}`}
              className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/5 transition-colors group"
              style={{
                background: isCurrent ? "rgba(124,92,255,0.1)" : "transparent",
              }}
            >
              <button
                onClick={() => playAt(i)}
                className="w-6 text-center text-xs tabular-nums"
                style={{
                  color: isCurrent ? "var(--accent)" : "var(--text-secondary)",
                }}
              >
                {isCurrent && isPlaying
                  ? "♪"
                  : String(i + 1).padStart(2, "0")}
              </button>

              {coverUrl ? (
                <img
                  src={coverUrl}
                  alt=""
                  className="w-10 h-10 rounded object-cover bg-white/5 flex-shrink-0"
                  referrerPolicy="no-referrer"
                  onError={(e) =>
                    ((e.target as HTMLImageElement).style.visibility = "hidden")
                  }
                />
              ) : (
                <div className="w-10 h-10 rounded bg-white/5 flex-shrink-0 flex items-center justify-center text-sm">
                  {song.source === "netease" ? "☁️" : "🎵"}
                </div>
              )}

              <button
                onClick={() => playAt(i)}
                className="flex-1 min-w-0 text-left"
              >
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
              </button>

              <span
                className="text-xs tabular-nums"
                style={{ color: "var(--text-secondary)" }}
              >
                {formatTime(song.duration)}
              </span>

              <button
                onClick={() => removeFromQueue(i)}
                className="opacity-0 group-hover:opacity-100 transition-opacity w-6 h-6 rounded flex items-center justify-center hover:bg-white/10 text-xs"
                style={{ color: "#f87171" }}
                title="从列表移除"
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
