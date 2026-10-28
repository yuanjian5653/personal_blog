"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { usePlayer } from "./PlayerProvider";
import { formatTime } from "@/lib/format";
import { getCoverUrl } from "@/lib/types";

/**
 * 播放条折叠状态的存储 key。
 *
 * 值： "1" 收起 / "0" 展开 / 不存在 = 默认收起。
 *
 * 用 localStorage 而不是 sessionStorage：折叠/展开是用户的长期偏好，
 * 应该跨会话保留。之前用 sessionStorage，关掉标签页就忘了，
 * 每次进来又变回占满底部一整条的形态。
 */
const MINIMIZED_KEY = "player_bar_collapsed";

/** 读取用户上次的选择；没记录过 = 默认收起 */
function readMinimized(): boolean {
  // 服务端渲染时没有 localStorage，按"收起"处理。
  // 这里不会造成水合不一致：currentSong 在首帧一定是 null，
  // 组件直接 return null，两侧输出都是空。
  if (typeof window === "undefined") return true;
  try {
    return localStorage.getItem(MINIMIZED_KEY) !== "0";
  } catch {
    return true;
  }
}

export default function PlayerBar() {
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

  const pathname = usePathname();

  // 默认收起：右下角只留一个小胶囊（封面 + 播放键 + 展开箭头），
  // 不再默认占满屏幕底部一整条。
  const [minimized, setMinimized] = useState(readMinimized);

  const toggleMinimized = (v: boolean) => {
    setMinimized(v);
    try {
      localStorage.setItem(MINIMIZED_KEY, v ? "1" : "0");
    } catch {}
  };

  if (pathname.startsWith("/admin")) return null;
  if (!currentSong) return null;

  const cycleMode = () => {
    const order: Array<"order" | "loop" | "single"> = ["order", "loop", "single"];
    const idx = order.indexOf(playMode);
    setPlayMode(order[(idx + 1) % order.length]);
  };


  const modeLabel = { order: "顺序", loop: "随机", single: "单曲" }[playMode];

  // ===== 最小化形态：只有封面 + 播放键 + 展开按钮 =====
  if (minimized) {
    return (
      <div className="fixed bottom-4 right-4 z-40">
        <div
          className="flex items-center gap-2 p-2 rounded-full"
          style={{
            background: "rgba(18,20,28,0.85)",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
            border: "1px solid rgba(255,255,255,0.08)",
            boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
          }}
        >
          <img
            src={getCoverUrl(currentSong)}
            alt=""
            className="w-9 h-9 rounded-full object-cover bg-white/5"
            onError={(e) => {
              (e.target as HTMLImageElement).style.visibility = "hidden";
            }}
          />
          <button
            onClick={toggle}
            className="w-9 h-9 rounded-full flex items-center justify-center"
            style={{ background: "var(--accent)", color: "#fff" }}
            title={isPlaying ? "暂停" : "播放"}
          >
            {isPlaying ? "⏸" : "▶"}
          </button>
          <button
            onClick={() => toggleMinimized(false)}
            className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-white/10 text-xs"
            title="展开播放器"
          >
            ▲
          </button>
        </div>
      </div>
    );
  }

  // ===== 完整形态 =====
  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-40"
      style={{
        background: "rgba(18,20,28,0.85)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        borderTop: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      <div className="max-w-6xl mx-auto px-6 py-3 flex items-center gap-4">
        {/* 最小化按钮 */}
        <button
          onClick={() => toggleMinimized(true)}
          className="w-6 h-6 rounded flex items-center justify-center hover:bg-white/10 text-xs"
          title="最小化"
        >
          ▼
        </button>

        {/* 封面 */}
        <img
          src={getCoverUrl(currentSong)}
          alt={currentSong.title}
          className="w-12 h-12 rounded-lg object-cover bg-white/5"
          onError={(e) => {
            (e.target as HTMLImageElement).style.visibility = "hidden";
          }}
        />

        {/* 歌曲信息 */}
        <div className="min-w-0 w-40">
          <Link
            href="/music"
            className="block text-sm font-medium truncate hover:underline"
          >
            {currentSong.title}
          </Link>
          <div
            className="text-xs truncate"
            style={{ color: "var(--text-secondary)" }}
          >
            {currentSong.artist}
          </div>
        </div>

        {/* 控制按钮 */}
        <div className="flex items-center gap-2">
          <button onClick={prev} className="text-sm px-2 py-1 hover:opacity-70" title="上一首">
            ⏮
          </button>
          <button
            onClick={toggle}
            className="w-9 h-9 rounded-full flex items-center justify-center text-lg"
            style={{ background: "var(--accent)", color: "#fff" }}
            title={isPlaying ? "暂停" : "播放"}
          >
            {isPlaying ? "⏸" : "▶"}
          </button>
          <button onClick={next} className="text-sm px-2 py-1 hover:opacity-70" title="下一首">
            ⏭
          </button>
        </div>

        {/* 进度条 */}
        <div className="flex-1 flex items-center gap-2">
          <span className="text-xs tabular-nums" style={{ color: "var(--text-secondary)" }}>
            {formatTime(currentTime)}
          </span>
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={currentTime}
            onChange={(e) => seek(Number(e.target.value))}
            className="flex-1 h-1 accent-[var(--accent)] cursor-pointer"
          />
          <span className="text-xs tabular-nums" style={{ color: "var(--text-secondary)" }}>
            {formatTime(duration)}
          </span>
        </div>

        {/* 播放模式 */}
        <button
          onClick={cycleMode}
          className="text-xs px-2 py-1 rounded hover:opacity-70"
          style={{ color: "var(--text-secondary)" }}
          title={`播放模式：${modeLabel}`}
        >
          {modeLabel}
        </button>

        {/* 音量 */}
        <div className="flex items-center gap-2">
          <span className="text-sm">🔊</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={(e) => setVolume(Number(e.target.value))}
            className="w-20 h-1 accent-[var(--accent)] cursor-pointer"
          />
        </div>
      </div>
    </div>
  );
}