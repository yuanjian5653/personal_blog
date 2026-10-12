/**
 * 音乐页的各个区块。
 *
 * 原先这些组件全都堆在 app/music/page.tsx 里（900 行），
 * 现在按"一个区块一个文件"拆开，页面文件只负责组织布局与标签切换。
 */
export { default as NowPlayingCard } from "./NowPlayingCard";
export { default as LocalTab } from "./LocalTab";
export { default as NeteaseTab } from "./NeteaseTab";
export { default as QueueTab } from "./QueueTab";
export { default as LyricsTab } from "./LyricsTab";
