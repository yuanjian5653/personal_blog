/**
 * 播放列表的合并与筛选（纯函数，便于在无浏览器环境测试）。
 *
 * 背景：以前音乐页分「本地」和「网易云」两个标签，各看各的列表，
 * 想连着听就得手动"加入播放列表"。现在把两边合成一个列表：
 * 本地歌曲在前、网易云在后，并去掉重复项。
 */
import type { Song } from "./types";

/** 歌曲唯一标识：本地 id 是正数、网易云 id 取负，再用 source 兜底 */
export function songKey(song: Song): string {
  return `${song.source ?? "local"}:${song.id}`;
}

/**
 * 合并本地与网易云两个列表。
 *
 * - 本地在前（用户自己上传的、能稳定离线播放）
 * - 按 songKey 去重，保留首次出现的那条
 * - 不修改入参
 */
export function mergePlaylists(local: Song[], netease: Song[]): Song[] {
  const seen = new Set<string>();
  const out: Song[] = [];

  for (const song of [...local, ...netease]) {
    const key = songKey(song);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(song);
  }

  return out;
}

/**
 * 按关键词筛选（标题 / 歌手 / 专辑，均忽略大小写）。
 * 关键词为空白时返回原列表。
 */
export function filterSongs(songs: Song[], keyword: string): Song[] {
  const q = keyword.trim().toLowerCase();
  if (!q) return songs;

  return songs.filter((s) => {
    const haystack = `${s.title} ${s.artist} ${s.album ?? ""}`.toLowerCase();
    return haystack.includes(q);
  });
}

export interface PlaylistStats {
  total: number;
  local: number;
  netease: number;
  /** 总时长（秒） */
  duration: number;
}

/** 列表统计：用来在面板顶部显示「共 N 首 / 本地 X / 网易云 Y」 */
export function playlistStats(songs: Song[]): PlaylistStats {
  let local = 0;
  let netease = 0;
  let duration = 0;

  for (const s of songs) {
    if (s.source === "netease") netease += 1;
    else local += 1;
    if (typeof s.duration === "number" && s.duration > 0) duration += s.duration;
  }

  return { total: songs.length, local, netease, duration };
}

/**
 * 在列表里定位当前播放的歌。
 * 返回 -1 表示当前歌曲不在这个列表里（例如从别处点播的）。
 */
export function indexOfSong(songs: Song[], current: Song | null): number {
  if (!current) return -1;
  const key = songKey(current);
  return songs.findIndex((s) => songKey(s) === key);
}
