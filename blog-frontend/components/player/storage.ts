/**
 * 播放状态的本地持久化（localStorage）。
 *
 * 从 PlayerProvider 里抽出来的原因：读写存档、音量记忆、"是不是同一首歌"
 * 这些都与 React 无关，抽出来之后 Provider 只负责调用。
 */
import type { Song } from "@/lib/types";
import type { PlayMode } from "@/lib/playback";
import { normalizeMode } from "@/lib/playback";

/**
 * 用 localStorage 而不是 sessionStorage：
 *   sessionStorage 的作用域是**单个标签页**，关掉浏览器就没了，
 *   所以以前每次重新进入网站播放器都会重置（歌单空、回到"点击音乐页开始播放"）。
 *   localStorage 跨会话保留，再配合保存的 currentTime，
 *   下次打开能接着上次的位置继续。
 *
 * 版本号 v2：数据结构和 v1 不兼容（新增 currentTime / playMode），
 * 换 key 可以避免读到旧结构导致异常。
 */
const PLAYER_STATE_KEY = "player_state_v2";

/** 音量单独存一个 key（不随播放会话清空） */
const VOLUME_KEY = "player_volume";

/** 一次播放会话的完整快照 */
export interface SavedPlayerState {
  playlist: Song[];
  currentIndex: number;
  currentSong: Song | null;
  /** 上次播放到的秒数，用于恢复进度 */
  currentTime: number;
  playMode: PlayMode;
}

export function savePlayerState(state: SavedPlayerState): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(PLAYER_STATE_KEY, JSON.stringify(state));
  } catch {
    // 隐私模式 / 配额满：忽略，不影响播放
  }
}

export function loadPlayerState(): SavedPlayerState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(PLAYER_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SavedPlayerState>;
    if (!Array.isArray(parsed.playlist) || parsed.playlist.length === 0) {
      return null;
    }
    return {
      playlist: parsed.playlist,
      currentIndex: parsed.currentIndex ?? 0,
      currentSong: parsed.currentSong ?? null,
      currentTime:
        typeof parsed.currentTime === "number" ? parsed.currentTime : 0,
      // 旧存档可能没有 playMode，也可能是已废弃的值 —— 统一规整
      playMode: normalizeMode(parsed.playMode),
    };
  } catch {
    return null;
  }
}

/** 清空播放存档（clearQueue 时用） */
export function clearPlayerState(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(PLAYER_STATE_KEY);
  } catch {}
}

/* ---------------- 音量 ---------------- */

export function loadVolume(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(VOLUME_KEY);
    if (raw === null) return null;
    const v = Number(raw);
    return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : null;
  } catch {
    return null;
  }
}

export function saveVolume(v: number): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(VOLUME_KEY, String(v));
  } catch {}
}

/* ---------------- 歌曲比较 ---------------- */

/** 同一首歌才恢复进度：按 source + id 判断 */
export function sameSong(
  a: Song | null | undefined,
  b: Song | null | undefined
): boolean {
  if (!a || !b) return false;
  return a.id === b.id && (a.source ?? "local") === (b.source ?? "local");
}
