"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { Song } from "@/lib/types";
import { getCoverUrl, getStreamUrl } from "@/lib/types";
import type { APlayerInstance } from "@/lib/aplayer";

export type PlayMode = "order" | "loop" | "single";

interface PlayerContextValue {
  currentSong: Song | null;
  playlist: Song[];
  currentIndex: number;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  playMode: PlayMode;
  play: (song: Song, list?: Song[]) => void;
  toggle: () => void;
  next: () => void;
  prev: () => void;
  seek: (time: number) => void;
  setVolume: (v: number) => void;
  setPlayMode: (m: PlayMode) => void;
  addToQueue: (song: Song) => void;
  addSongsToQueue: (songs: Song[]) => void;
  playAt: (index: number) => void;
  removeFromQueue: (index: number) => void;
  clearQueue: () => void;
  getFrequencyData: () => Uint8Array | null;
}

const PlayerContext = createContext<PlayerContextValue | null>(null);

/* ============ APlayer 脚本加载 ============ */
let aplayerLoadPromise: Promise<void> | null = null;

function loadAPlayer(): Promise<void> {
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
        script.src =
          "https://cdn.jsdelivr.net/npm/aplayer/dist/APlayer.min.js";
        script.onload = () => resolve();
        script.onerror = () => reject(new Error("APlayer 加载失败"));
        document.head.appendChild(script);
      });
    }
  })();

  return aplayerLoadPromise;
}

/* ============ Song → APlayer 音频对象 ============ */
function toAPlayerAudio(song: Song) {
  return {
    name: song.title,
    artist: song.artist,
    url: getStreamUrl(song),
    cover: getCoverUrl(song),
    lrc: "",
    theme: "#7c5cff",
  };
  // 说明：歌词不交给 APlayer 渲染，由 TextCard 通过 getLyricUrl 自行拉取，
  // 所以这里 lrc 固定为空，也不再计算 lrc 地址。
}

/* ============ sessionStorage 持久化 ============ */
const PLAYER_STATE_KEY = "player_state_v1";

function savePlayerState(
  playlist: Song[],
  currentIndex: number,
  currentSong: Song | null
) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(
      PLAYER_STATE_KEY,
      JSON.stringify({ playlist, currentIndex, currentSong })
    );
  } catch {}
}

function loadPlayerState(): {
  playlist: Song[];
  currentIndex: number;
  currentSong: Song | null;
} | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(PLAYER_STATE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/* ============ Provider ============ */
export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const aplayerRef = useRef<APlayerInstance | null>(null);

  const [currentSong, setCurrentSong] = useState<Song | null>(null);
  const [playlist, setPlaylist] = useState<Song[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(0.8);
  const [playMode, setPlayModeState] = useState<PlayMode>("order");

  const playlistRef = useRef<Song[]>([]);
  const playModeRef = useRef<PlayMode>("order");
  // 忽略 listswitch 事件的标记（用代码主动切歌时）
  const ignoreListSwitchRef = useRef(false);

  useEffect(() => {
    playlistRef.current = playlist;
  }, [playlist]);
  useEffect(() => {
    playModeRef.current = playMode;
  }, [playMode]);

  /* ---------- 初始化 APlayer ---------- */
  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        await loadAPlayer();
      } catch (e) {
        console.warn("APlayer 加载失败", e);
        return;
      }
      if (!mounted || aplayerRef.current) return;
      // loadAPlayer() 正常返回时全局一定存在；这里只是让类型收窄
      const APlayer = window.APlayer;
      if (!APlayer) return;

      const container = document.createElement("div");
      container.style.cssText = `
        position: fixed;
        left: -9999px;
        top: -9999px;
        width: 1px;
        height: 1px;
        overflow: hidden;
        pointer-events: none;
      `;
      document.body.appendChild(container);
      containerRef.current = container;

      const ap = new APlayer({
        container,
        audio: [],
        listFolded: true,
        mini: false,
        theme: "#7c5cff",
        volume: 0.8,
        mutex: true,
        preload: "metadata",
      });
      aplayerRef.current = ap;

      // 恢复音量
      const savedVolume = localStorage.getItem("player_volume");
      if (savedVolume) {
        const v = Number(savedVolume);
        ap.volume(v, true);
        setVolumeState(v);
      }

      // ===== 恢复上次播放状态 =====
      const saved = loadPlayerState();
      if (saved && saved.playlist && saved.playlist.length > 0) {
        for (const s of saved.playlist) {
          ap.list.add(toAPlayerAudio(s));
        }
        playlistRef.current = saved.playlist;
        setPlaylist(saved.playlist);
        setCurrentIndex(saved.currentIndex ?? 0);
        setCurrentSong(saved.currentSong ?? saved.playlist[0]);
        // 不自动播放（浏览器策略）
      }

      // ===== 事件监听 =====
      ap.on("play", () => setIsPlaying(true));
      ap.on("pause", () => setIsPlaying(false));

      ap.on("timeupdate", () => {
        setCurrentTime(ap.audio?.currentTime || 0);
      });

      ap.on("loadedmetadata", () => {
        setDuration(ap.audio?.duration || 0);
      });

      // APlayer 内部切歌（用户点 APlayer 的下一首，或 ended 时）
      ap.on("listswitch", () => {
        const idx = ap.list?.index ?? -1;
        setCurrentIndex(idx);
        // 忽略代码触发的 switch，避免覆盖刚设置的 currentSong
        if (ignoreListSwitchRef.current) {
          ignoreListSwitchRef.current = false;
          return;
        }
        const list = playlistRef.current;
        if (list[idx]) setCurrentSong(list[idx]);
      });

      ap.on("ended", () => {
        const mode = playModeRef.current;
        const list = playlistRef.current;

        if (mode === "single") {
          ap.seek(0);
          ap.play();
        } else if (mode === "loop" && list.length > 1) {
          const idx = Math.floor(Math.random() * list.length);
          ignoreListSwitchRef.current = true;
          ap.list.switch(idx);
          setCurrentIndex(idx);
          setCurrentSong(list[idx]);
          ap.play();
        } else {
          ignoreListSwitchRef.current = true;
          ap.skipForward();
          const idx = ap.list.index;
          setCurrentIndex(idx);
          if (list[idx]) setCurrentSong(list[idx]);
        }
      });
    })();

    return () => {
      mounted = false;
      if (aplayerRef.current) {
        try {
          aplayerRef.current.destroy();
        } catch {}
        aplayerRef.current = null;
      }
      if (containerRef.current) {
        try {
          containerRef.current.remove();
        } catch {}
        containerRef.current = null;
      }
    };
  }, []);

  /* ---------- 持久化播放状态 ---------- */
  useEffect(() => {
    if (playlist.length === 0) return;
    savePlayerState(playlist, currentIndex, currentSong);
  }, [playlist, currentIndex, currentSong]);

    /* ---------- 播放指定歌曲 ---------- */
  const play = useCallback((song: Song, list?: Song[]) => {
    const ap = aplayerRef.current;
    if (!ap) return;

    const targetList = list && list.length > 0 ? list : playlistRef.current;
    const index = targetList.findIndex(
      (s) => s.id === song.id && s.source === song.source
    );
    const realIndex = index >= 0 ? index : 0;

    // 1. 先同步 ref（关键！让 listswitch 事件读到新数据）
    playlistRef.current = targetList;

    // 2. 打标记，忽略接下来的 listswitch 事件
    ignoreListSwitchRef.current = true;

    // 3. 同步 React 状态（让顶部卡片立即更新）
    setPlaylist(targetList);
    setCurrentIndex(realIndex);
    setCurrentSong(targetList[realIndex] || song);

    // 4. 一次性清空 APlayer 列表
    while (ap.list.audios.length > 0) {
      ap.list.remove(0);
    }

    // 5. 一次性添加整个列表（APlayer 支持数组，别循环 add）
    const audios = targetList.map(toAPlayerAudio);
    ap.list.add(audios);

    // 6. 关键：用双层 requestAnimationFrame 确保列表 DOM 就绪后再播放
    //    直接 ap.play() 会触发 "play() request was interrupted" 错误
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        try {
          ap.list.switch(realIndex);
          ap.play();
        } catch (e) {
          console.warn("APlayer 播放失败", e);
        }
      });
    });
  }, []);

  /* ---------- 播放/暂停 ---------- */
  const toggle = useCallback(() => {
    const ap = aplayerRef.current;
    if (!ap || !ap.audio) return;
    if (ap.audio.paused) ap.play();
    else ap.pause();
  }, []);

  /* ---------- 上一首 / 下一首 ---------- */
    const next = useCallback(() => {
    const ap = aplayerRef.current;
    if (!ap) return;
    const list = playlistRef.current;
    if (list.length === 0) return;
    const newIndex = (ap.list.index + 1) % list.length;
    ignoreListSwitchRef.current = true;
    setCurrentIndex(newIndex);
    setCurrentSong(list[newIndex]);
    ap.list.switch(newIndex);
    // APlayer 内部切歌需要一点时间加载 metadata
    setTimeout(() => ap.play(), 50);
  }, []);

  const prev = useCallback(() => {
    const ap = aplayerRef.current;
    if (!ap) return;
    const list = playlistRef.current;
    if (list.length === 0) return;
    const newIndex = (ap.list.index - 1 + list.length) % list.length;
    ignoreListSwitchRef.current = true;
    setCurrentIndex(newIndex);
    setCurrentSong(list[newIndex]);
    ap.list.switch(newIndex);
    setTimeout(() => ap.play(), 50);
  }, []);

  /* ---------- 进度跳转 ---------- */
  const seek = useCallback((time: number) => {
    aplayerRef.current?.seek(time);
    setCurrentTime(time);
  }, []);

  /* ---------- 音量 ---------- */
  const setVolume = useCallback((v: number) => {
    const ap = aplayerRef.current;
    if (ap) ap.volume(v, true);
    setVolumeState(v);
    localStorage.setItem("player_volume", String(v));
  }, []);

  /* ---------- 播放模式 ---------- */
  const setPlayMode = useCallback((m: PlayMode) => {
    setPlayModeState(m);
  }, []);

    const addToQueue = useCallback((song: Song) => {
    const ap = aplayerRef.current;
    if (!ap) return;
    const exists = playlistRef.current.some(
      (s) => s.id === song.id && s.source === song.source
    );
    if (exists) return;
    ap.list.add(toAPlayerAudio(song));
    const next = [...playlistRef.current, song];
    playlistRef.current = next;
    setPlaylist(next);
  }, []);

  const addSongsToQueue = useCallback((songs: Song[]) => {
    const ap = aplayerRef.current;
    if (!ap) return;
    const existingKeys = new Set(
      playlistRef.current.map((s) => `${s.source}-${s.id}`)
    );
    const newOnes = songs.filter(
      (s) => !existingKeys.has(`${s.source}-${s.id}`)
    );
    if (newOnes.length === 0) return;
    // 一次性添加数组
    ap.list.add(newOnes.map(toAPlayerAudio));
    const next = [...playlistRef.current, ...newOnes];
    playlistRef.current = next;
    setPlaylist(next);
  }, []);

  const playAt = useCallback((index: number) => {
    const ap = aplayerRef.current;
    if (!ap) return;
    const list = playlistRef.current;
    if (index < 0 || index >= list.length) return;
    ignoreListSwitchRef.current = true;
    ap.list.switch(index);
    ap.play();
    setCurrentIndex(index);
    setCurrentSong(list[index]);
  }, []);

  const removeFromQueue = useCallback((index: number) => {
    const ap = aplayerRef.current;
    if (!ap) return;
    ap.list.remove(index);
    const next = playlistRef.current.filter((_, i) => i !== index);
    playlistRef.current = next;
    setPlaylist(next);
  }, []);

  const clearQueue = useCallback(() => {
    const ap = aplayerRef.current;
    if (!ap) return;
    while (ap.list.audios.length > 0) {
      ap.list.remove(0);
    }
    playlistRef.current = [];
    setPlaylist([]);
    setCurrentSong(null);
    setCurrentIndex(-1);
    setCurrentTime(0);
    setDuration(0);
    sessionStorage.removeItem(PLAYER_STATE_KEY);
  }, []);

    /* ---------- 频谱数据（供 TextCard 波频条用）---------- */
  const getFrequencyData = useCallback((): Uint8Array | null => {
    const data = new Uint8Array(32);
    const ap = aplayerRef.current;
    const playing = !!(ap?.audio && !ap.audio.paused);
    if (!playing) return data;

    // 多层正弦波 + 随机抖动，幅度更大更有节奏感
    const t = Date.now() / 120;
    for (let i = 0; i < 32; i++) {
      const wave1 = Math.sin(t + i * 0.35) * 45;
      const wave2 = Math.sin(t * 1.6 + i * 0.7) * 30;
      const noise = (Math.random() - 0.5) * 35;
      const value = 175 + wave1 + wave2 + noise;
      data[i] = Math.max(80, Math.min(255, Math.round(value)));
    }
    return data;
  }, []);

  const value: PlayerContextValue = {
    currentSong,
    playlist,
    currentIndex,
    isPlaying,
    currentTime,
    duration,
    volume,
    playMode,
    play,
    toggle,
    next,
    prev,
    seek,
    setVolume,
    setPlayMode,
    addToQueue,
    addSongsToQueue,
    playAt,
    removeFromQueue,
    clearQueue,
    getFrequencyData,
  };

  return (
    <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>
  );
}

export function usePlayer() {
  const ctx = useContext(PlayerContext);
  if (!ctx) {
    throw new Error("usePlayer 必须在 PlayerProvider 内使用");
  }
  return ctx;
}