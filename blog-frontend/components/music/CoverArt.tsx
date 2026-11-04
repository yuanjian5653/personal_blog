"use client";

import { useState } from "react";

import { getCoverUrl, hasCover, type Song } from "@/lib/types";

interface Props {
  song: Song | null;
  /** 图片的类名（尺寸由使用方决定） */
  className?: string;
  /** 没有封面、或图片加载失败时显示的内容 */
  fallback?: React.ReactNode;
  alt?: string;
}

/**
 * 歌曲封面。
 *
 * 存在的意义：getCoverUrl() 对本地歌曲**总是**返回一个地址
 * （/api/music/cover/{id}），但本地歌若没上传封面、或封面文件丢了，
 * 后端会 404 —— 直接拿它当 src 就是一张破图。
 *
 * 所以这里做两件事：
 *   1. 先用 hasCover() 判断"到底有没有封面"，没有就直接渲染 fallback
 *   2. 真的有也挂 onError：文件缺失时同样退回 fallback
 * 失败按"哪首歌"记录，切歌时比较结果自然失效，不需要额外的重置逻辑。
 */
export default function CoverArt({
  song,
  className,
  fallback = null,
  alt = "",
}: Props) {
  const key = song ? `${song.source ?? "local"}-${song.id}` : "";
  const [failedKey, setFailedKey] = useState<string | null>(null);

  const usable = !!song && hasCover(song) && failedKey !== key;

  if (!usable) return <>{fallback}</>;

  return (
    // eslint-disable-next-line @next/next/no-img-element -- 封面尺寸固定、来源是后端接口或外链 CDN，无需 next/image
    <img
      className={className}
      src={getCoverUrl(song)}
      alt={alt}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailedKey(key)}
    />
  );
}
