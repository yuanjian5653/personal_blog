"use client";

import { useEffect, useState } from "react";

import { api } from "@/lib/api";
import type { NeteaseAccount, NeteasePlaylist, NeteaseSong, Song } from "@/lib/types";
import { usePlayer } from "@/components/player/PlayerProvider";
import { formatTime } from "@/lib/format";
import { toHttpsUrl } from "@/lib/url";
import SkeletonLoader from "@/components/ui/SkeletonLoader";

/** 网易云歌曲 → 播放器用的统一 Song 结构 */
function toSong(ns: NeteaseSong): Song {
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

/** 标签 2：网易云帐号与歌单 */
export default function NeteaseTab() {
  const [account, setAccount] = useState<NeteaseAccount | null>(null);
  const [playlists, setPlaylists] = useState<NeteasePlaylist[]>([]);
  // account 本身可能为 null（未登录），用一个独立标志表示"加载完成"
  const [loaded, setLoaded] = useState(false);
  const loading = !loaded;
  const [activePlaylist, setActivePlaylist] = useState<NeteasePlaylist | null>(
    null
  );
  const [songs, setSongs] = useState<NeteaseSong[]>([]);
  const [songsLoading, setSongsLoading] = useState(false);
  const [songsCache, setSongsCache] = useState<Record<number, NeteaseSong[]>>(
    {}
  );
  const { play, addSongsToQueue, currentSong, isPlaying, toggle } = usePlayer();

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      api.get<NeteaseAccount>("/api/netease/account"),
      api.get<{ playlists: NeteasePlaylist[] }>("/api/netease/my-playlists"),
      api.get<{ configs: Record<string, string> }>("/api/site-config"),
    ])
      .then(([acc, pls, cfg]) => {
        if (cancelled) return;
        setAccount(acc);

        // 如果后台配置了只显示某个歌单，就过滤出它
        const configuredId = cfg.configs.netease_playlist_id;
        let display = pls.playlists;
        if (configuredId) {
          const found = pls.playlists.filter(
            (p) => String(p.id) === configuredId
          );
          if (found.length > 0) display = found;
        }
        setPlaylists(display);

        // 如果配置只显示一个歌单，直接打开它
        if (configuredId && display.length === 1) {
          const only = display[0];
          setActivePlaylist(only);
          api
            .get<NeteaseSong[]>(`/api/netease/playlist/${only.id}/songs`)
            .then((data) => {
              if (cancelled) return;
              setSongs(data);
              setSongsCache((prev) => ({ ...prev, [only.id]: data }));
            })
            .catch(() => {});
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const openPlaylist = (pl: NeteasePlaylist) => {
    setActivePlaylist(pl);
    if (songsCache[pl.id]) {
      setSongs(songsCache[pl.id]);
      return;
    }
    setSongsLoading(true);
    api
      .get<NeteaseSong[]>(`/api/netease/playlist/${pl.id}/songs`)
      .then((data) => {
        setSongs(data);
        setSongsCache((prev) => ({ ...prev, [pl.id]: data }));
      })
      .catch(() => setSongs([]))
      .finally(() => setSongsLoading(false));
  };

  if (loading) return <SkeletonLoader lines={4} />;

  if (!account?.logged_in) {
    return (
      <div
        className="glass p-8 text-sm space-y-2"
        style={{ color: "var(--text-secondary)" }}
      >
        <p style={{ color: "#f87171" }}>未配置 NETEASE_MUSIC_U</p>
        <p>在 blog-backend/.env 里配置 MUSIC_U 后重启后端</p>
      </div>
    );
  }

  /* ==================== 歌单详情页 ==================== */
  if (activePlaylist) {
    const converted = songs.map(toSong);
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={() => setActivePlaylist(null)}
            className="text-sm px-3 py-1.5 rounded-lg hover:bg-white/10"
            style={{ color: "var(--text-secondary)" }}
          >
            ← 返回歌单列表
          </button>
          <h3 className="text-base font-semibold">{activePlaylist.name}</h3>
          <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
            {activePlaylist.track_count} 首
          </span>

          {songs.length > 0 && (
            <button
              onClick={() => addSongsToQueue(converted)}
              className="ml-auto text-xs px-3 py-1.5 rounded-lg"
              style={{ background: "var(--accent)", color: "#fff" }}
            >
              全部加入播放列表
            </button>
          )}
        </div>

        {songsLoading ? (
          <SkeletonLoader lines={4} />
        ) : (
          <div className="glass p-2">
            {songs.map((s, i) => {
              const isCurrent =
                currentSong?.source === "netease" &&
                currentSong?.netease_id === s.id;
              return (
                <div
                  key={s.id}
                  onClick={() => {
                    if (isCurrent) {
                      toggle();
                    } else {
                      play(toSong(s), converted);
                    }
                  }}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/5 transition-colors cursor-pointer"
                  style={{
                    background: isCurrent ? "rgba(124,92,255,0.1)" : "transparent",
                  }}
                >
                  <span
                    className="w-6 text-center text-xs tabular-nums"
                    style={{
                      color: isCurrent ? "var(--accent)" : "var(--text-secondary)",
                    }}
                  >
                    {isCurrent && isPlaying
                      ? "♪"
                      : String(i + 1).padStart(2, "0")}
                  </span>

                  {s.cover_url ? (
                    <img
                      src={toHttpsUrl(s.cover_url)}
                      alt=""
                      className="w-10 h-10 rounded object-cover bg-white/5 flex-shrink-0"
                      referrerPolicy="no-referrer"
                      onError={(e) =>
                        ((e.target as HTMLImageElement).style.visibility =
                          "hidden")
                      }
                    />
                  ) : (
                    <div className="w-10 h-10 rounded bg-white/5 flex-shrink-0" />
                  )}

                  <div className="flex-1 min-w-0">
                    <div
                      className="text-sm truncate"
                      style={{
                        color: isCurrent ? "var(--accent)" : "var(--text-primary)",
                      }}
                    >
                      {s.name}
                    </div>
                    <div
                      className="text-xs truncate"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      {s.artists}
                    </div>
                  </div>

                  <span
                    className="text-xs tabular-nums"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    {formatTime(s.duration)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  /* ==================== 歌单网格（默认） ==================== */
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 glass p-4">
        {account.avatar && (
          <img
            src={toHttpsUrl(account.avatar)}
            alt=""
            className="w-10 h-10 rounded-full"
            referrerPolicy="no-referrer"
          />
        )}
        <div>
          <div className="text-sm font-medium">{account.nickname}</div>
          <div className="text-xs" style={{ color: "var(--text-secondary)" }}>
            共 {playlists.length} 个歌单
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 md:grid-cols-5 lg:grid-cols-6 gap-4">
        {playlists.map((pl) => (
          <button
            key={pl.id}
            onClick={() => openPlaylist(pl)}
            className="group text-left"
          >
            <div className="relative aspect-square rounded-lg overflow-hidden mb-2 bg-white/5">
              {pl.cover_url ? (
                <img
                  src={toHttpsUrl(pl.cover_url)}
                  alt={pl.name}
                  className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                  referrerPolicy="no-referrer"
                  onError={(e) =>
                    ((e.target as HTMLImageElement).style.visibility = "hidden")
                  }
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-2xl">
                  🎵
                </div>
              )}
              <div className="absolute top-2 right-2 text-[10px] px-1.5 py-0.5 rounded bg-black/60 text-white">
                {pl.track_count}
              </div>
            </div>
            <div className="text-xs font-medium line-clamp-2 mb-0.5">
              {pl.name}
            </div>
            <div
              className="text-[10px] line-clamp-1"
              style={{ color: "var(--text-secondary)" }}
            >
              {pl.creator}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

export { toSong };
