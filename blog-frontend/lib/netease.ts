/**
 * 网易云歌曲 → 播放器统一 Song 结构。
 *
 * 从 components/music/NeteaseTab.tsx 里搬出来的：现在「合并播放列表」
 * 和网易云相关组件都要用它，放在 lib 里避免组件互相 import。
 */
import type { NeteaseSong, Song } from "./types";

/**
 * id 取负数：本地歌曲 id 是正数，网易云 id 也可能撞上，
 * 用 source + id 一起判定唯一性（见 PlayerProvider 的 sameSong）。
 */
export function neteaseToSong(ns: NeteaseSong): Song {
  return {
    id: -ns.id,
    title: ns.name,
    artist: ns.artists,
    album: ns.album,
    duration: ns.duration,
    cover_path: null,
    lyrics_path: null,
    genre: null,
    year: null,
    bitrate: null,
    file_size: null,
    play_count: 0,
    created_at: new Date().toISOString(),
    source: "netease",
    netease_id: ns.id,
    cover_url: ns.cover_url || undefined,
  };
}
