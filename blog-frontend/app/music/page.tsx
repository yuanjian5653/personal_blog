"use client";

import { useState } from "react";

import { usePlayer } from "@/components/player/PlayerProvider";
import {
  LyricsTab,
  LocalTab,
  NeteaseTab,
  NowPlayingCard,
  QueueTab,
} from "@/components/music";

type TabKey = "local" | "netease" | "queue" | "lyrics";

const TABS: Array<{ key: TabKey; label: string; icon: string }> = [
  { key: "lyrics", label: "歌词", icon: "♪" },
  { key: "local", label: "本地", icon: "💾" },
  { key: "netease", label: "网易云", icon: "☁️" },
  { key: "queue", label: "播放列表", icon: "☰" },
];

export default function MusicPage() {
  const [tab, setTab] = useState<TabKey>("lyrics");
  const { isPlaying, currentSong } = usePlayer();

  return (
    <div className="space-y-6 max-w-4xl mx-auto pt-2">
      <NowPlayingCard />

      <div className="tab-switch">
        {TABS.map((t) => {
          const active = tab === t.key;
          // 正在播放时给「歌词」标签加一圈微光，提示有内容
          const glow = t.key === "lyrics" && currentSong && isPlaying;
          return (
            <div
              key={t.key}
              className={`tab ${active ? "active" : ""}`}
              onClick={() => setTab(t.key)}
            >
              <div
                className="name"
                style={{
                  boxShadow:
                    glow && !active
                      ? "inset 0 0 0 1px rgba(124,92,255,0.4)"
                      : undefined,
                }}
              >
                <span>{t.icon}</span>
                <span>{t.label}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* 四个标签全部渲染，用 display 切换：避免切标签时组件重新挂载、
          丢失各标签内部的滚动位置与已加载的数据 */}
      <div>
        <div style={{ display: tab === "lyrics" ? "block" : "none" }}>
          <LyricsTab />
        </div>
        <div style={{ display: tab === "local" ? "block" : "none" }}>
          <LocalTab />
        </div>
        <div style={{ display: tab === "netease" ? "block" : "none" }}>
          <NeteaseTab />
        </div>
        <div style={{ display: tab === "queue" ? "block" : "none" }}>
          <QueueTab />
        </div>
      </div>
    </div>
  );
}
