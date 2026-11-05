/**
 * APlayer 的加载与数据转换。
 *
 * 从 PlayerProvider 里抽出来的原因：这两件事与 React 状态无关，
 * 纯粹是"往页面插 CDN 脚本"和"把 Song 转成 APlayer 要的结构"，
 * 留在 Provider 里只会让它更长。
 *
 * APlayer 的官方类型用不上（没有随包安装，是运行时从 CDN 加载的全局脚本），
 * 我们用 lib/aplayer.d.ts 里自己声明的最小类型。
 */
import type { Song } from "@/lib/types";
import { getCoverUrl, getStreamUrl } from "@/lib/types";

/* ============ APlayer 脚本加载 ============ */
let aplayerLoadPromise: Promise<void> | null = null;

/**
 * 确保 APlayer 的 CSS 与 JS 已注入（全局只加载一次）。
 * 多次调用共享同一个 Promise，不会重复插脚本。
 */
export function loadAPlayer(): Promise<void> {
  if (aplayerLoadPromise) return aplayerLoadPromise;

  aplayerLoadPromise = (async () => {
    if (!document.querySelector("link[data-aplayer-style]")) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "https://cdn.jsdelivr.net/npm/aplayer/dist/APlayer.min.css";
      link.setAttribute("data-aplayer-style", "1");
      document.head.appendChild(link);
    }
    if (!window.APlayer) {
      await new Promise<void>((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "https://cdn.jsdelivr.net/npm/aplayer/dist/APlayer.min.js";
        script.onload = () => resolve();
        script.onerror = () => reject(new Error("APlayer 加载失败"));
        document.head.appendChild(script);
      });
    }
  })();

  return aplayerLoadPromise;
}

/* ============ Song → APlayer 音频对象 ============ */
/**
 * 把 Song 转成 APlayer 的音频项。
 *
 * 说明：歌词不交给 APlayer 渲染，由 TextCard 通过 getLyricUrl 自行拉取，
 * 所以这里 lrc 固定为空，也不再计算 lrc 地址。
 */
export function toAPlayerAudio(song: Song) {
  return {
    name: song.title,
    artist: song.artist,
    url: getStreamUrl(song),
    cover: getCoverUrl(song),
    lrc: "",
    theme: "#7c5cff",
  };
}
