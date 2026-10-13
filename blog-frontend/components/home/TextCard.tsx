"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { usePlayer } from "@/components/player/PlayerProvider";
import { api } from "@/lib/api";
import { parseLrc, findActiveLyricIndex, type LyricLine } from "@/lib/lrc";
import { getLyricUrl } from "@/lib/types";
import { useTypewriter } from "@/lib/useTypewriter";

const DEFAULT_TEXT = "好，支持，威武，有希望了！ ( ) #(滑稽)";

/** 频谱波频条：5 根，颜色渐变，纯 CSS 自由跳动 */
function FrequencyBars({
  playing,
  color1,
  color2,
}: {
  playing: boolean;
  color1: string;
  color2: string;
}) {
  // 颜色插值（保持不变）
  const lerpColor = (a: string, b: string, t: number) => {
    const hex = (c: string) => {
      const v = c.replace("#", "");
      return [
        parseInt(v.slice(0, 2), 16),
        parseInt(v.slice(2, 4), 16),
        parseInt(v.slice(4, 6), 16),
      ];
    };
    const [r1, g1, b1] = hex(a);
    const [r2, g2, b2] = hex(b);
    const r = Math.round(r1 + (r2 - r1) * t);
    const g = Math.round(g1 + (g2 - g1) * t);
    const bl = Math.round(b1 + (b2 - b1) * t);
    return `rgb(${r}, ${g}, ${bl})`;
  };

  // 每根柱子的动画参数不同，看起来错落
  const bars = [
    { duration: 0.7, delay: 0 },
    { duration: 0.9, delay: 0.15 },
    { duration: 0.6, delay: 0.3 },
    { duration: 1.0, delay: 0.05 },
    { duration: 0.8, delay: 0.2 },
  ];

  return (
    <div className="flex items-end gap-[4px] h-10 flex-shrink-0">
      {bars.map((cfg, i) => {
        const color = lerpColor(color1, color2, i / 4);
        return (
          <div
            key={i}
            className="wave-bar transition-opacity"
            style={{
              height: playing ? undefined : "30%",
              background: color,
              boxShadow: playing ? `0 0 8px ${color}88` : "none",
              opacity: playing ? 1 : 0.5,
              animationName: playing ? "waveBounce" : "none",
              animationDuration: `${cfg.duration}s`,
              animationDelay: `${cfg.delay}s`,
              animationIterationCount: "infinite",
              animationTimingFunction: "ease-in-out",
            }}
          />
        );
      })}
    </div>
  );
}
/** 逐字打字 + 逐字删除的动画组件（时序逻辑见 lib/typewriter-core.ts） */
function Typewriter({
  text,
  typeSpeed,
  deleteSpeed,
  holdAfterType,
  holdAfterDelete,
  loop,
}: {
  text: string;
  typeSpeed?: number;
  deleteSpeed?: number;
  holdAfterType?: number;
  holdAfterDelete?: number;
  loop?: boolean;
}) {
  const tw = useTypewriter(text, {
    typeSpeed,
    deleteSpeed,
    holdAfterType,
    holdAfterDelete,
    loop,
  });

  return (
    <>
      {tw.text}
      {tw.typing && (
        <span
          className="inline-block w-[2px] h-[1em] ml-0.5 align-middle animate-pulse"
          style={{ background: "var(--accent)" }}
        />
      )}
    </>
  );
}

export default function TextCard() {
  const { currentSong, currentTime, isPlaying } = usePlayer();
  const pathname = usePathname();

  const [textContent, setTextContent] = useState(DEFAULT_TEXT);
  const [waveColor1, setWaveColor1] = useState("#4f5cd6");
  const [waveColor2, setWaveColor2] = useState("#ff2d9b");

  useEffect(() => {
    if (pathname.startsWith("/admin")) return;
    api
      .get<{ configs: Record<string, string> }>("/api/site-config")
      .then((d) => {
        if (d.configs.card_text) setTextContent(d.configs.card_text);
        if (d.configs.card_wave_color1)
          setWaveColor1(d.configs.card_wave_color1);
        if (d.configs.card_wave_color2)
          setWaveColor2(d.configs.card_wave_color2);
      })
      .catch(() => {});
  }, [pathname]);

  const typed = useTypewriter(textContent);

  // 歌词内容与"它属于哪首歌"一起存，切歌时无需 setLyrics([]) 清空
  const [lyricsData, setLyricsData] = useState<{
    key: string;
    lines: LyricLine[];
  } | null>(null);

  const lyricsKey = currentSong
    ? `${currentSong.source ?? "local"}-${currentSong.id}`
    : null;
  const lyrics =
    lyricsKey && lyricsData?.key === lyricsKey ? lyricsData.lines : [];

  // 歌词加载：本地 / 网易云都支持
  useEffect(() => {
    if (!currentSong) return;
    const k = `${currentSong.source ?? "local"}-${currentSong.id}`;
    let cancelled = false;

    fetch(getLyricUrl(currentSong))
      .then((res) => (res.ok ? res.json() : Promise.reject()))
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

  const showLyrics = isPlaying && lyrics.length > 0;
  const showNowPlaying = isPlaying && lyrics.length === 0;

  return (
    <div className="glass px-6 py-4 flex items-center justify-center gap-4 h-[80px] overflow-hidden"
         style={{
        // 换你想要的颜色
        background: "rgba(10, 17, 21, 0.85)",
        border: "1px solid rgba(0, 0, 0, 0.06)",
      }}>
      {/* 左侧：波频条 */}
      <FrequencyBars
        playing={isPlaying}
        color1={waveColor1}
        color2={waveColor2}
      />

      {/* 中间：文字 / 歌词 */}
      <div className="flex-1 min-w-0 h-full relative overflow-hidden">
        {showLyrics ? (
          <div
            className="absolute inset-x-0 transition-transform duration-500 ease-out"
            style={{
              top: "50%",
              transform: `translateY(${
                -(activeIndex >= 0 ? activeIndex : 0) * 36 - 18
              }px)`,
            }}
          >
            {lyrics.map((line, i) => {
              const isActive = i === activeIndex;
              return (
                <div
                  key={i}
                  className="flex items-center justify-center text-sm transition-all duration-300 px-4"
                  style={{
                    height: "36px",
                    color: isActive
                      ? "var(--accent)"
                      : "var(--text-secondary)",
                    fontWeight: isActive ? 700 : 400,
                    opacity: isActive ? 1 : 0.5,
                    transform: isActive ? "scale(1.08)" : "scale(1)",
                  }}
                >
                  {/* 当前行：打字 → 停顿 → 删除；其他行直接显示 */}
                  {isActive ? (
                    <Typewriter
                      text={line.text}
                      typeSpeed={55}
                      deleteSpeed={30}
                      holdAfterType={1200}
                      holdAfterDelete={250}
                    />
                  ) : (
                    line.text
                  )}
                </div>
              );
            })}
          </div>
                ) : showNowPlaying ? (
          <div className="h-full flex items-center justify-center">
            <p className="text-base font-medium text-center truncate">
              <span style={{ color: "var(--text-secondary)" }}>正在播放 </span>
              <span style={{ color: "var(--accent)" }}>
                <Typewriter
                  text={currentSong?.title || ""}
                  typeSpeed={60}
                  deleteSpeed={30}
                  holdAfterType={1500}
                  holdAfterDelete={300}
                />
              </span>
            </p>
          </div>
        ) : (
          <div className="h-full flex items-center justify-center">
            <p className="text-base font-medium text-center truncate">
              {typed.text}
              {typed.typing && (
                <span
                  className="inline-block w-[2px] h-[1em] ml-0.5 align-middle animate-pulse"
                  style={{ background: "var(--accent)" }}
                />
              )}
            </p>
          </div>
        )}
      </div>

      {/* 右侧：音符图标 */}
      <span
        className="text-lg flex-shrink-0"
        style={{ color: "var(--accent)", opacity: 0.6 }}
      >
        ♪
      </span>
    </div>
  );
}