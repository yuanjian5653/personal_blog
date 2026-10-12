/**
 * 音乐相关的 TypeScript 类型
 * 与后端 schemas/music.py 对应
 */

import { API_BASE } from "./api";

export interface Song {
  id: number;
  title: string;
  artist: string;
  album: string;
  duration: number;
  cover_path: string | null;
  lyrics_path: string | null;
  genre: string | null;
  year: string | null;
  bitrate: number | null;
  file_size: number | null;
  play_count: number;
  created_at: string;
  // === 新增：区分来源 ===
  source?: "local" | "netease";
  netease_id?: number;
  cover_url?: string;       // 网易云封面
  stream_url?: string;      // 自定义 stream 地址

}

export interface Playlist {
  id: number;
  name: string;
  description: string | null;
  cover_path: string | null;
  sort_order: number;
}

/* ============ 网易云（/api/netease/*）============ */

export interface NeteaseAccount {
  logged_in: boolean;
  nickname?: string;
  uid?: number;
  avatar?: string;
  message?: string;
}

export interface NeteasePlaylist {
  id: number;
  name: string;
  cover_url: string | null;
  track_count: number;
  creator: string;
  is_mine: boolean;
}

export interface NeteaseSong {
  id: number;
  name: string;
  artists: string;
  album: string;
  cover_url: string | null;
  duration: number;
}

/* ============ 播放地址（本地 / 网易云统一出口）============ */

/** 歌曲是否为网易云来源 */
export function isNeteaseSong(song: Song): boolean {
  return song.source === "netease" && !!song.netease_id;
}

/**
 * 音频流地址。
 * 本地歌曲走后端 Range 流，网易云走代理流。
 */
export function getStreamUrl(song: Song): string {
  return isNeteaseSong(song)
    ? `${API_BASE}/api/netease/stream/${song.netease_id}`
    : `${API_BASE}/api/music/stream/${song.id}`;
}

/** 歌词接口地址，format="text" 时返回纯文本（APlayer 用） */
export function getLyricUrl(song: Song, format: "json" | "text" = "json"): string {
  const suffix = format === "text" ? "?format=text" : "";
  return isNeteaseSong(song)
    ? `${API_BASE}/api/netease/lyric/${song.netease_id}${suffix}`
    : `${API_BASE}/api/music/lyrics/${song.id}${suffix}`;
}

/** 封面地址只需要这几个字段，本地歌曲类型也能直接传进来 */
export type CoverSource = Pick<Song, "id" | "source" | "cover_url">;

/** 封面地址：网易云用外链，本地用后端接口 */
export function getCoverUrl(song: CoverSource): string {
  if (song.cover_url) {
    return song.cover_url.replace(/^http:\/\//, "https://");
  }
  if (song.source === "netease") return "";
  return `${API_BASE}/api/music/cover/${song.id}`;
}

export interface PlaylistDetail extends Playlist {
  songs: Song[];
}

export interface AdminInfo {
  id: number;
  username: string;
}

export interface Article {
  id: number;
  title: string;
  slug: string;
  content: string;
  excerpt: string | null;
  cover_path: string | null;
  category: string | null;
  tags: string | null;
  is_pinned: boolean;
  read_time: number;
  word_count: number;
  view_count: number;
  like_count: number;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface ArticleListItem {
  id: number;
  title: string;
  slug: string;
  excerpt: string | null;
  cover_path: string | null;
  category: string | null;
  tags: string | null;
  is_pinned: boolean;
  read_time: number;
  word_count: number;
  view_count: number;
  like_count: number;
  status: string;
  created_at: string;
}

export interface Essay {
  id: number;
  title: string;
  content: string;
  excerpt: string | null;
  images: string[];
  likes: number;
  created_at: string;
  updated_at: string;
}

export interface Category {
  name: string;
  count: number;
}

export interface Photo {
  id: number;
  album_id: number;
  file_path: string;
  title: string | null;
  description: string | null;
  sort_order: number;
  created_at: string;
}

export interface Album {
  id: number;
  name: string;
  description: string | null;
  cover_path: string | null;
  date_label: string | null;
  sort_order: number;
  photo_count: number;
  preview_photos: string[];      // ← 新增
  created_at: string;
}

export interface AlbumDetail extends Album {
  photos: Photo[];
}

export interface Tag {
  name: string;
  count: number;
}

export interface LifePost {
  id: number;
  content: string;
  images: string[];
  location: string | null;
  created_at: string;
}