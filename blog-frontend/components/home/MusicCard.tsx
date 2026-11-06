"use client";

import { useState } from "react";
import Link from "next/link";

import PlayerControls from "@/components/player/PlayerControls";
import PlayerProgress from "@/components/player/PlayerProgress";
import { usePlayer } from "@/components/player/PlayerProvider";
import { getCoverUrl, hasCover } from "@/lib/types";

/**
 * 首页音乐卡片。
 *
 * 视觉来自 uiverse「Tsiangana / modern-monkey-77」的分层玩法：
 *   底层两团圆球（带发光、各自缓慢游动）
 *   → 上面盖一层毛玻璃（backdrop-filter 把光斑糊成缓慢晕开的彩色光晕）
 *   → 内容再叠在玻璃之上、居中竖排
 *
 * 相对参考稿做的优化（都是它原版的实际问题）：
 *   · 光斑用 transform 动画，而不是动 top/left —— 后者每帧触发布局，
 *     这里改成 translate，只走合成层
 *   · 参考稿写死 190×254 与 rgba(255,255,255,.55) 的白色玻璃，
 *     这里尺寸自适应父容器，玻璃与描边全部走主题变量，
 *     因此跟随「原版毛玻璃 / 黑色毛玻璃」切换
 *   · 参考稿的圆形图标砖换成**真实专辑封面**（没封面时退回黑胶占位）
 *   · 参考稿没有进度条，这里补上（音乐卡片不能没有进度）
 *   · 不加 .glass 类：那会给卡片再加一层 backdrop-filter，
 *     光斑就不再是「透过玻璃看」而是「玻璃后面还有一层玻璃」
 *
 * 功能全部保留：封面/歌名/歌手、进度条、模式/上一首/播放/下一首/静音、
 * 跳转音乐页、未播放时的空态。
 * 进度条与控制键仍是 components/player 下的共享组件，与音乐页一致。
 */
export default function MusicCard() {
  const { currentSong, isPlaying } = usePlayer();

  // 记录"加载封面失败的是哪首歌"，而不是一个布尔值。
  // 这样切歌时比较结果自然变成 false，不需要"切歌就重置"的 effect。
  const songKey = `${currentSong?.source ?? ""}-${currentSong?.id ?? ""}`;
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const coverError = errorKey === songKey;

  // 本地歌若没有 cover_path，后端 /api/music/cover 会 404，
  // 所以先用 hasCover 判断再渲染 <img>，避免破图。
  const shownCover =
    !!currentSong && hasCover(currentSong) && !coverError;
  const coverSrc = currentSong ? getCoverUrl(currentSong) : "";

  return (
    <div
      className={`music-card mp-theme${currentSong ? "" : " is-empty"}${
        isPlaying ? " is-playing" : ""
      }`}
    >
      {/* 底层：两团游动的光斑（参考稿的 .two / .three）。
          播放时换成更短周期的呼吸动画，见 music-card.css */}
      <span className="music-card__glow music-card__glow--a" aria-hidden="true" />
      <span className="music-card__glow music-card__glow--b" aria-hidden="true" />

      {/* 中层：毛玻璃。只负责把下面的光斑糊开，并把整个面板压成一个玻璃面 */}
      <span className="music-card__frost" aria-hidden="true" />

      {/* 上层：内容 */}
      <div className="music-card__inner">
        <span className="music-card__badge">Music</span>

        {currentSong ? (
          <>
            <Link
              href="/music"
              className="music-card__tile"
              aria-label="打开音乐页"
              title={currentSong.title}
            >
              {shownCover ? (
                <img
                  key={`${currentSong.source}-${currentSong.id}`}
                  src={coverSrc}
                  alt={currentSong.title}
                  referrerPolicy="no-referrer"
                  onError={() => setErrorKey(songKey)}
                />
              ) : (
                /*
                 * 无封面时的黑胶占位。
                 *
                 * 原来用的是 `.disc` / `.disc-spin` / `.disc-paused` ——
                 * 这三个类在黑胶改版后**已经不存在于任何样式表**里，
                 * 于是这只是一个空 span；而里面的 ♪ 是绝对定位，
                 * 又没有任何定位祖先，结果按页面定位跑到卡片外面去了。
                 * 鼠标一悬浮，.music-card__tile:hover 的 transform 临时
                 * 创建了定位上下文，♪ 又跳回卡片里 —— 就是"悬浮前后不一样"。
                 *
                 * 现在改成自成一体的结构：外壳负责定位，内层负责转。
                 */
                <span className="music-card__disc" aria-hidden="true">
                  <span
                    className={`music-card__disc-vinyl${
                      isPlaying ? " is-spinning" : ""
                    }`}
                  />
                  <span className="music-card__disc-core">♪</span>
                </span>
              )}
            </Link>

            <Link
              href="/music"
              className="music-card__title"
              title={currentSong.title}
            >
              {currentSong.title}
            </Link>
            <p className="music-card__artist" title={currentSong.artist}>
              {currentSong.artist}
            </p>

            {/* 进度条 + 控制键：与音乐页共用同一对组件 */}
            <div className="music-card__transport">
              <PlayerProgress />
              <PlayerControls />
            </div>
          </>
        ) : (
          <>
            <span className="music-card__tile music-card__tile--idle" aria-hidden="true">
              🎵
            </span>
            <p className="music-card__empty-text">点击音乐页开始播放</p>
            <Link href="/music" className="music-card__empty-cta">
              去音乐页
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
