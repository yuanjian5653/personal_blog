"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { usePlayer } from "@/components/player/PlayerProvider";
import { api } from "@/lib/api";
import { parseLrc, findActiveLyricIndex, type LyricLine } from "@/lib/lrc";
import { getLyricUrl } from "@/lib/types";

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
/** 歌词行打字效果：先逐字删除旧行，再逐字打出新行 */
function LyricTyper({
  text,
  speed = 200,
  deleteSpeed = 25,
}: {
  text: string;
  speed?: number;
  deleteSpeed?: number;
}) {
  const [displayed, setDisplayed] = useState("");
  // 记录当前正在显示（或正在删除）的旧文本
  const currentTextRef = useRef("");
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  /** 清理所有定时器 */
  const clearTimers = () => {
    timersRef.current.forEach((t) => clearTimeout(t));
    timersRef.current = [];
  };

  useEffect(() => {
    clearTimers();

    const oldText = currentTextRef.current;
    currentTextRef.current = text;

    // 如果新文本和当前已显示的完全一致，直接跳过
    if (oldText === text && displayed === text) return;

    // 第一步：逐字删除旧的
    let deleteIdx = displayed.length;
    const doDelete = () => {
      if (deleteIdx > 0) {
        deleteIdx--;
        setDisplayed((prev) => prev.slice(0, prev.length - 1));
        const t = setTimeout(doDelete, deleteSpeed);
        timersRef.current.push(t);
      } else {
        // 第二步：逐字打出新的
        let typeIdx = 0;
        const doType = () => {
          if (typeIdx < text.length) {
            typeIdx++;
            setDisplayed(text.slice(0, typeIdx));
            const t = setTimeout(doType, speed);
            timersRef.current.push(t);
          }
        };
        doType();
      }
    };

    // 用 setTimeout(0) 让首次渲染先完成
    const startTimer = setTimeout(doDelete, 0);
    timersRef.current.push(startTimer);

    return clearTimers;
    // 依赖 text：每次换行都重新触发删除+打字
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  // 组件卸载时清理
  useEffect(() => {
    return clearTimers;
  }, []);

  return (
    <>
      {displayed}
      {displayed.length < text.length && (
        <span
          className="inline-block w-[2px] h-[1em] ml-0.5 align-middle animate-pulse"
          style={{ background: "var(--accent)" }}
        />
      )}
    </>
  );
}

/** 打字动画 Hook：打字 → 停顿 → 删除 → 停顿 → 循环 */
function useTypewriterLoop(
  text: string,
  speed = 90,
  pauseEnd = 2000,
  pauseStart = 600
) {
  // 动画状态与"它属于哪段文本"绑在一起。
  // text 变了就当成全新状态（displayed="" / index=0 / phase="typing"），
  // 于是不需要"text 变化就重置状态"的 effect。
  const [state, setState] = useState<{
    forText: string;
    displayed: string;
    index: number;
    phase: "typing" | "deleting";
  }>({ forText: text, displayed: "", index: 0, phase: "typing" });

  const fresh = { forText: text, displayed: "", index: 0, phase: "typing" as const };
  const cur = state.forText === text ? state : fresh;
  const { displayed, index, phase } = cur;

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;

    if (phase === "typing") {
      if (index < text.length) {
        timer = setTimeout(
          () =>
            setState({
              forText: text,
              displayed: text.slice(0, index + 1),
              index: index + 1,
              phase: "typing",
            }),
          speed
        );
      } else {
        timer = setTimeout(
          () => setState({ ...fresh, phase: "deleting" }),
          pauseEnd
        );
      }
    } else {
      if (index > 0) {
        timer = setTimeout(
          () =>
            setState({
              forText: text,
              displayed: text.slice(0, index - 1),
              index: index - 1,
              phase: "deleting",
            }),
          speed / 2
        );
      } else {
        timer = setTimeout(() => setState({ ...fresh }), pauseStart);
      }
    }

    return () => clearTimeout(timer);
    // fresh 每次渲染都是新对象，但从 text 派生，列出 text 等原始依赖即可
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, phase, text, speed, pauseEnd, pauseStart]);

  return displayed;
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

  const typedText = useTypewriterLoop(textContent);

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
                  {/* 当前行用"先删除再打字"的效果，其他行直接显示 */}
                  {isActive ? (
                    <LyricTyper text={line.text} speed={50} deleteSpeed={20} />
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
                <LyricTyper
                  text={currentSong?.title || ""}
                  speed={60}
                  deleteSpeed={25}
                />
              </span>
            </p>
          </div>
        ) : (
          <div className="h-full flex items-center justify-center">
            <p className="text-base font-medium text-center truncate">
              {typedText}
              <span
                className="inline-block w-[2px] h-[1em] ml-0.5 align-middle animate-pulse"
                style={{ background: "var(--accent)" }}
              />
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