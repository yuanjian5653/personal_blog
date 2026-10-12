"use client";

import { getCoverUrl } from "@/lib/types";
import { usePlayer } from "@/components/player/PlayerProvider";
import { formatTime } from "@/lib/format";

/** 顶部大播放卡片：唱片封面 + 进度条 + 播放控制 + 音量 */
export default function NowPlayingCard() {
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

  const cycleMode = () => {
    const order: Array<"order" | "loop" | "single"> = ["order", "loop", "single"];
    const idx = order.indexOf(playMode);
    setPlayMode(order[(idx + 1) % order.length]);
  };

  if (!currentSong) {
    return (
      <div className="glass p-8 flex items-center justify-center min-h-[200px]">
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          从下方选择一个歌曲开始播放
        </p>
      </div>
    );
  }

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const coverUrl = getCoverUrl(currentSong);

  return (
    <div className="glass p-8">
      <div className="flex items-center gap-8">
        {/* 左侧唱片/封面 */}
        <div className="relative w-40 h-40 flex-shrink-0">
          <div
            className={`w-full h-full rounded-full overflow-hidden ${
              isPlaying ? "disc-spin" : "disc-paused"
            }`}
            style={{
              background:
                "radial-gradient(circle at center, #1a1a1a 0%, #0a0a0a 70%)",
              boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
            }}
          >
            {coverUrl ? (
              <img
                src={coverUrl}
                alt={currentSong.title}
                className="w-full h-full object-cover"
                referrerPolicy="no-referrer"
                style={{
                  transform: "scale(0.72)",
                  borderRadius: "9999px",
                }}
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-4xl">
                🎵
              </div>
            )}
          </div>
        </div>

        {/* 右侧信息 + 控制 */}
        <div className="flex-1 min-w-0">
          <h2 className="text-2xl font-bold mb-1 truncate">
            {currentSong.title}
          </h2>
          <p className="text-sm mb-6" style={{ color: "var(--text-secondary)" }}>
            {currentSong.artist}
          </p>

          {/* 进度条 */}
          <div className="mb-5">
            <div
              className="flex justify-between text-xs mb-2 tabular-nums"
              style={{ color: "var(--text-secondary)" }}
            >
              <span>{formatTime(currentTime)}</span>
              <span>{formatTime(duration)}</span>
            </div>
            <div
              className="relative h-1 rounded-full"
              style={{ background: "rgba(255,255,255,0.1)" }}
            >
              <div
                className="absolute left-0 top-0 h-full rounded-full"
                style={{ width: `${progress}%`, background: "var(--accent)" }}
              />
              <input
                type="range"
                min={0}
                max={duration || 0}
                step={0.1}
                value={currentTime}
                onChange={(e) => seek(Number(e.target.value))}
                className="absolute inset-0 w-full opacity-0 cursor-pointer"
              />
            </div>
          </div>

          {/* 控制按钮 */}
          <div className="flex items-center gap-4">
            <button
              onClick={cycleMode}
              className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-white/10 transition-colors"
              title={`播放模式：${{ order: "顺序", loop: "随机", single: "单曲" }[playMode]}`}
            >
              <span className="text-sm" style={{ color: "var(--text-secondary)" }}>
                {{ order: "↻", loop: "🔀", single: "🔂" }[playMode]}
              </span>
            </button>

            <button
              onClick={prev}
              className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-white/10 transition-colors text-lg"
            >
              ⏮
            </button>

            <button
              onClick={toggle}
              className="w-12 h-12 rounded-full flex items-center justify-center text-xl text-white"
              style={{ background: "var(--accent)" }}
            >
              {isPlaying ? "⏸" : "▶"}
            </button>

            <button
              onClick={next}
              className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-white/10 transition-colors text-lg"
            >
              ⏭
            </button>

            <div className="flex items-center gap-2 ml-2">
              <span className="text-sm" style={{ color: "var(--text-secondary)" }}>
                🔊
              </span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={volume}
                onChange={(e) => setVolume(Number(e.target.value))}
                className="w-24 h-1 accent-[var(--accent)] cursor-pointer"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
