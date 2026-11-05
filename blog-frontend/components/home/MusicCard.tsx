"use client";

import { useState } from "react";
import Link from "next/link";
import { ListMusic } from "lucide";
import { MorphIcon } from "morphicons/react";

import PlayerControls from "@/components/player/PlayerControls";
import PlayerProgress from "@/components/player/PlayerProgress";
import { usePlayer } from "@/components/player/PlayerProvider";
import { getCoverUrl, hasCover } from "@/lib/types";

/**
 * 首页音乐卡片（参考 uiverse「music player card」的圆角 + 渐变 + 极简）。
 *
 * 相比上一版压掉了一圈高度（min-height 290 -> 236）：
 *   · 去掉顶部独立的 "Music" 标题行
 *   · 封面 64 -> 56
 *   · 去掉底部"查看全部"整行，改成头部右上角一个播放列表图标按钮
 *   · 内边距 20 -> 16
 * 功能一个没少：封面/歌名/歌手、进度条、模式/上一首/播放/下一首/静音、
 * 跳转音乐页、未播放时的空态。
 *
 * 进度条与控制键仍是 components/player 下的共享组件 —— 与音乐页完全一致。
 */
export default function MusicCard() {
  const { currentSong, isPlaying } = usePlayer();

  // 记录"加载封面失败的是哪首歌"，而不是一个布尔值。
  // 这样切歌时比较结果自然变成 false，不需要"切歌就重置"的 effect。
  const songKey = `${currentSong?.source ?? ""}-${currentSong?.id ?? ""}`;
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const coverError = errorKey === songKey;

  if (!currentSong) {
    return (
      <div className="glass music-card music-card--empty mp-theme">
        <span className="music-card__wash" aria-hidden="true" />
        <div className="music-card__inner">
          <span className="music-card__empty-icon" aria-hidden="true">
            🎵
          </span>
          <p className="music-card__empty-text">点击音乐页开始播放</p>
          <Link href="/music" className="music-card__empty-cta">
            去音乐页
          </Link>
        </div>
      </div>
    );
  }

  // 本地歌若没有 cover_path，后端 /api/music/cover 会 404，
  // 所以先用 hasCover 判断再渲染 <img>，避免破图。
  const shownCover = hasCover(currentSong) && !coverError;
  const coverSrc = getCoverUrl(currentSong);

  return (
    <div className="glass music-card mp-theme">
      {/* 参考稿的渐变底：两团低透明度色斑，颜色由主题强调色混出来 */}
      <span className="music-card__wash" aria-hidden="true" />

      <div className="music-card__inner">
        {/* 头部：封面 + 曲目信息 + 去音乐页 */}
        <div className="music-card__head">
          <Link href="/music" className="music-card__cover" aria-label="打开音乐页">
            {shownCover ? (
              <img
                key={`${currentSong.source}-${currentSong.id}`}
                src={coverSrc}
                alt={currentSong.title}
                referrerPolicy="no-referrer"
                onError={() => setErrorKey(songKey)}
              />
            ) : (
              <span
                className={`disc music-card__disc ${
                  isPlaying ? "disc-spin" : "disc-paused"
                }`}
                aria-hidden="true"
              >
                <span className="music-card__disc-core">♪</span>
              </span>
            )}
          </Link>

          <div className="music-card__meta">
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
          </div>

          <Link
            href="/music"
            className="music-card__more"
            aria-label="打开播放列表"
            title="打开播放列表"
          >
            <MorphIcon icon={ListMusic} size={15} />
          </Link>
        </div>

        {/* 进度条与控制键：与音乐页共用同一对组件 */}
        <PlayerProgress />
        <PlayerControls />
      </div>
    </div>
  );
}
