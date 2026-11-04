"use client";

import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";
import { mergePlaylists } from "@/lib/musicPlaylist";
import { neteaseToSong } from "@/lib/netease";
import type { NeteaseSong, Song } from "@/lib/types";

/** 后端 /api/netease/public-playlist 的返回结构 */
interface PublicPlaylistResponse {
  configured: boolean;
  playlist_id: number | null;
  name: string;
  songs: NeteaseSong[];
}

export interface MergedPlaylistState {
  songs: Song[];
  /** true = 还在加载（此时 songs 是空数组） */
  loading: boolean;
  /** 网易云歌单名字，用于面板标题 */
  playlistName: string;
  /** 网易云部分为什么没进来；null 表示一切正常 */
  neteaseNote: string | null;
  /** 是否值得给用户一个"重试"入口（未配置歌单不算失败） */
  neteaseFailed: boolean;
  reload: () => void;
}

/**
 * 拉取「本地歌曲 + 站点配置的网易云歌单」，合并成一个播放列表。
 *
 * 以前音乐页是「本地」「网易云」两个标签各看各的，想连着听要手动加入队列。
 * 现在合并成一份列表，点任意一首播放时把整份列表交给播放器，
 * 上一首/下一首就能在本地与网易云之间自然衔接。
 */
export function useMergedPlaylist(): MergedPlaylistState {
  // null = 还在加载；用 null 而不是单独的 loading 标志，
  // 避免在 effect 里同步 setLoading（那会触发 set-state-in-effect 规则）
  const [songs, setSongs] = useState<Song[] | null>(null);
  const [playlistName, setPlaylistName] = useState("");
  const [neteaseNote, setNeteaseNote] = useState<string | null>(null);
  const [neteaseFailed, setNeteaseFailed] = useState(false);
  // 每次 +1 触发重新拉取（由按钮的事件处理器调用，不在 effect 里）
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => {
    setSongs(null);
    setNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const localPromise = api
      .get<Song[]>("/api/music/songs")
      .then((list) => list.map((s) => ({ ...s, source: "local" as const })))
      // 本地接口挂了也让页面能用（至少还能放网易云）
      .catch(() => [] as Song[]);

    const neteasePromise = api
      .get<PublicPlaylistResponse>("/api/netease/public-playlist")
      .then((d) => {
        if (!d.configured) {
          return {
            songs: [] as Song[],
            name: "",
            note: "后台还没选网易云歌单",
            failed: false,
          };
        }
        return {
          songs: (d.songs || []).map(neteaseToSong),
          name: d.name || "",
          note: null as string | null,
          failed: false,
        };
      })
      .catch(() => ({
        songs: [] as Song[],
        name: "",
        note: "网易云歌单暂时取不到",
        failed: true,
      }));

    Promise.all([localPromise, neteasePromise]).then(([local, netease]) => {
      if (cancelled) return;
      setSongs(mergePlaylists(local, netease.songs));
      setPlaylistName(netease.name);
      setNeteaseNote(netease.note);
      setNeteaseFailed(netease.failed);
    });

    return () => {
      cancelled = true;
    };
  }, [nonce]);

  return {
    songs: songs ?? [],
    loading: songs === null,
    playlistName,
    neteaseNote,
    neteaseFailed,
    reload,
  };
}
