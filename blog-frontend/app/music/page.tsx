"use client";

import { usePlayer } from "@/components/player/PlayerProvider";
import MusicConsole from "@/components/music/MusicConsole";
import MusicTransport from "@/components/music/MusicTransport";
import VinylDeck from "@/components/music/VinylDeck";
import { useMergedPlaylist } from "@/components/music/useMergedPlaylist";
import type { Song } from "@/lib/types";

/**
 * 音乐页：左边唱片机，右边歌词/播放列表 + 控制条。
 *
 * 「本地」和「网易云」不再是两个标签，而是合并成同一份播放列表
 * （useMergedPlaylist 负责拉取与合并）。点任意一首播放时，
 * 把整份合并列表交给播放器，上一首/下一首即可在两个来源间连续。
 */
export default function MusicPage() {
  const { songs, loading, playlistName, neteaseNote, neteaseFailed, reload } =
    useMergedPlaylist();
  const { currentSong, isPlaying, volume, setVolume, play } = usePlayer();

  const handlePick = (song: Song) => {
    play(song, songs);
  };

  return (
    <div className="music-page">
      <div className="music-page__inner">
        <VinylDeck
          song={currentSong}
          playing={isPlaying}
          volume={volume}
          onVolumeChange={setVolume}
        />

        <div className="music-page__side">
          <MusicConsole
            songs={songs}
            loading={loading}
            playlistName={playlistName}
            note={neteaseNote}
            onPick={handlePick}
          />
          <MusicTransport />
        </div>
      </div>

      {/* 仅当网易云确实拉取失败时给重试入口；"还没配置歌单"不算失败 */}
      {neteaseFailed && !loading && (
        <button
          type="button"
          onClick={reload}
          style={{
            display: "block",
            margin: "0 auto 12px",
            padding: "4px 14px",
            borderRadius: 9999,
            border: "1px solid rgba(61,52,42,0.15)",
            background: "rgba(255,255,255,0.6)",
            color: "#8d8477",
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          重新加载列表
        </button>
      )}
    </div>
  );
}
