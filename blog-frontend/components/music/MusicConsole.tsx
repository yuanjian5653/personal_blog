"use client";

import { useMemo, useState } from "react";
import { ListMusic, Mic2 } from "lucide";
import { MorphIcon } from "morphicons/react";

import { usePlayer } from "@/components/player/PlayerProvider";
import { formatTime } from "@/lib/format";
import { filterSongs, playlistStats, songKey } from "@/lib/musicPlaylist";
import { getCoverUrl, type Song } from "@/lib/types";
import LyricsPanel from "./LyricsPanel";

type TabKey = "list" | "lyrics";

interface Props {
  songs: Song[];
  loading: boolean;
  playlistName: string;
  /** 网易云部分缺失的原因，null 表示正常 */
  note: string | null;
  onPick: (song: Song) => void;
}

/**
 * 右侧上半部分：歌词 / 播放列表 双标签面板。
 *
 * 播放列表是**本地 + 网易云合并后的同一份**（见 useMergedPlaylist），
 * 每行用徽标标出来源，点任意一首会把整份列表交给播放器，
 * 这样上一首/下一首能在两个来源之间自然衔接。
 */
export default function MusicConsole({
  songs,
  loading,
  playlistName,
  note,
  onPick,
}: Props) {
  const [tab, setTab] = useState<TabKey>("list");
  const [keyword, setKeyword] = useState("");
  const { currentSong, isPlaying } = usePlayer();

  const stats = useMemo(() => playlistStats(songs), [songs]);
  const visible = useMemo(() => filterSongs(songs, keyword), [songs, keyword]);
  const currentKey = currentSong ? songKey(currentSong) : null;

  const title = playlistName || "播放列表";

  return (
    <section className="mp-panel">
      <div className="mp-tabs">
        <button
          type="button"
          className={`mp-tab${tab === "list" ? " is-active" : ""}`}
          onClick={() => setTab("list")}
          aria-pressed={tab === "list"}
        >
          <MorphIcon icon={ListMusic} size={13} />
          播放列表
        </button>
        <button
          type="button"
          className={`mp-tab${tab === "lyrics" ? " is-active" : ""}`}
          onClick={() => setTab("lyrics")}
          aria-pressed={tab === "lyrics"}
        >
          <MorphIcon icon={Mic2} size={13} />
          歌词
        </button>

        <span className={`mp-live${isPlaying ? "" : " is-paused"}`}>
          <span className="mp-live__dot" aria-hidden="true" />
          {isPlaying ? "播放中" : "已暂停"}
        </span>
      </div>

      <div className="mp-body">
        {tab === "lyrics" ? (
          <LyricsPanel />
        ) : (
          <>
            <div className="mp-list__head">
              <span className="mp-list__title" title={title}>
                {title}
              </span>
              <span className="mp-list__count">
                共 {stats.total} 首 · 本地 {stats.local} · 网易云 {stats.netease}
              </span>
              <input
                className="mp-list__search"
                type="search"
                placeholder="搜索歌曲…"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                aria-label="搜索歌曲"
              />
            </div>

            {loading ? (
              <div className="mp-list__empty">正在加载播放列表…</div>
            ) : visible.length === 0 ? (
              <div className="mp-list__empty">
                {songs.length === 0 ? "还没有可播放的歌曲" : "没有匹配的歌曲"}
              </div>
            ) : (
              <div className="mp-list__rows">
                {visible.map((song, i) => {
                  const key = songKey(song);
                  const isCurrent = key === currentKey;
                  const cover = getCoverUrl(song);
                  return (
                    <button
                      type="button"
                      key={key}
                      className={`mp-row${isCurrent ? " is-current" : ""}`}
                      onClick={() => onPick(song)}
                      title={`${song.title} - ${song.artist}`}
                    >
                      <span className="mp-row__index">
                        {isCurrent && isPlaying
                          ? "♪"
                          : String(i + 1).padStart(2, "0")}
                      </span>
                      {cover ? (
                        // eslint-disable-next-line @next/next/no-img-element -- 封面尺寸固定 34px，且来源是后端/外链
                        <img className="mp-row__cover" src={cover} alt="" loading="lazy" />
                      ) : (
                        <span className="mp-row__cover" aria-hidden="true" />
                      )}
                      <span className="mp-row__text">
                        <span className="mp-row__title">{song.title}</span>
                        <span className="mp-row__artist">{song.artist}</span>
                      </span>
                      <span
                        className={`mp-row__badge mp-row__badge--${
                          song.source === "netease" ? "netease" : "local"
                        }`}
                      >
                        {song.source === "netease" ? "云" : "本地"}
                      </span>
                      <span className="mp-row__time">
                        {formatTime(song.duration)}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {note && <div className="mp-list__note">{note}</div>}
          </>
        )}
      </div>
    </section>
  );
}
