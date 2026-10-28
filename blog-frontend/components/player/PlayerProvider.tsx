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
import { api } from "@/lib/api";

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
  /** 当前无法播放的歌曲标题（网易云 VIP/版权限制等），null 表示正常 */
  playError: string | null;
  /** 手动清掉错误提示 */
  clearPlayError: () => void;
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

/* ============ 播放状态持久化 ============ */
//
// 用 localStorage 而不是 sessionStorage：
//   sessionStorage 的作用域是**单个标签页**，关掉浏览器/标签就没了，
//   所以以前每次重新进入网站播放器都会重置（歌单空、回到"点击音乐页开始播放"）。
//   localStorage 跨会话保留，再配合下面保存的 currentTime，
//   下次打开能接着上次的位置继续。
//
// 版本号 v2：数据结构和 v1 不兼容（新增 currentTime / playMode），
// 换 key 可以避免读到旧结构导致异常。
const PLAYER_STATE_KEY = "player_state_v2";

/** 一次播放会话的完整快照 */
interface SavedPlayerState {
  playlist: Song[];
  currentIndex: number;
  currentSong: Song | null;
  /** 上次播放到的秒数，用于恢复进度 */
  currentTime: number;
  playMode: PlayMode;
}

function savePlayerState(state: SavedPlayerState) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(PLAYER_STATE_KEY, JSON.stringify(state));
  } catch {
    // 隐私模式 / 配额满：忽略，不影响播放
  }
}

function loadPlayerState(): SavedPlayerState | null {
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
      currentTime: typeof parsed.currentTime === "number" ? parsed.currentTime : 0,
      playMode: parsed.playMode ?? "order",
    };
  } catch {
    return null;
  }
}

/** 同一首歌才恢复进度：按 source + id 判断 */
function sameSong(a: Song | null | undefined, b: Song | null | undefined) {
  if (!a || !b) return false;
  return a.id === b.id && (a.source ?? "local") === (b.source ?? "local");
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
  // 播放失败的提示（网易云 VIP / 版权限制时后端返回 404，audio 触发 error）
  const [playError, setPlayError] = useState<string | null>(null);

  // listswitch 回调里需要知道"当前这首歌叫什么"，用 ref 避免闭包拿到旧值
  const currentSongRef = useRef<Song | null>(null);
  useEffect(() => {
    currentSongRef.current = currentSong;
  }, [currentSong]);

  const playlistRef = useRef<Song[]>([]);
  const playModeRef = useRef<PlayMode>("order");

  /** 最近一次已知的播放进度（秒），用于节流写盘和恢复 */
  const currentTimeRef = useRef(0);
  /** 需要在音频元数据就绪后跳转到的位置（恢复上次进度） */
  const pendingSeekRef = useRef(0);
  /** 上次把进度写进 localStorage 的时间戳，用来节流 */
  const lastSaveAtRef = useRef(0);
  /** 供卸载时移除 pagehide 监听（需要在 IIFE 外持有引用） */
  const flushStateRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    playlistRef.current = playlist;
  }, [playlist]);
  useEffect(() => {
    playModeRef.current = playMode;
  }, [playMode]);

  /* ---------- 首次进入：用本地音乐填充播放器 ---------- */
  //
  // 目标：一进站首页音乐卡片就显示播放器（有封面/标题/进度条），
  // 而不是"点击音乐页开始播放"的空状态。
  //
  // 只取本地音乐（/api/music/songs），不掺网易云 —— 本地曲目稳定可播，
  // 不依赖 MUSIC_U Cookie，也不会因为 VIP/版权限制一进来就报错。
  //
  // 不自动播放：浏览器会拦截未经用户交互的带声音播放。
  // 用户点一下播放按钮即可，且下次进入会接着上次的进度。
  async function loadLocalSongsAsDefault(ap: APlayerInstance) {
    try {
      const songs = await api.get<Song[]>("/api/music/songs");
      if (!Array.isArray(songs) || songs.length === 0) return; // 本地库为空 → 保持空状态
      // 先同步 ref，listswitch 回调要靠它取列表
      playlistRef.current = songs;
      setPlaylist(songs);
      for (const s of songs) {
        ap.list.add(toAPlayerAudio(s));
      }
      try {
        ap.list.switch(0);
      } catch {}
      setCurrentIndex(0);
      setCurrentSong(songs[0]);
    } catch {
      // 取不到就保持空状态，不影响其它功能
    }
  }

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

      // ===== 恢复上次播放状态，没有历史则默认加载本地音乐 =====
      const saved = loadPlayerState();
      if (saved) {
        // —— 有历史：恢复歌单、当前曲、进度、播放模式 ——
        for (const s of saved.playlist) {
          ap.list.add(toAPlayerAudio(s));
        }
        playlistRef.current = saved.playlist;
        setPlaylist(saved.playlist);

        // 定位到上次那首歌：优先用保存的 currentSong，找不到就退回索引
        const savedIdx = saved.currentSong
          ? saved.playlist.findIndex((s) => sameSong(s, saved.currentSong))
          : -1;
        const idx =
          savedIdx >= 0
            ? savedIdx
            : Math.min(Math.max(saved.currentIndex, 0), saved.playlist.length - 1);

        const mode = saved.playMode ?? "order";
        setPlayModeState(mode);
        playModeRef.current = mode;

        setCurrentIndex(idx);
        setCurrentSong(saved.playlist[idx]);

        // 只有确实是同一首歌，才恢复播放进度
        if (sameSong(saved.playlist[idx], saved.currentSong) && saved.currentTime > 0) {
          pendingSeekRef.current = saved.currentTime;
          currentTimeRef.current = saved.currentTime;
          setCurrentTime(saved.currentTime);
        }

        // 让 APlayer 内部索引与 React 状态对齐。
        // （以前只 setState 不同步 APlayer，导致"恢复后点下一首会跳错歌"）
        try {
          ap.list.switch(idx);
        } catch {}

        // 注意：不自动播放 —— 浏览器会拦截"未经用户交互的带声音播放"。
        // 播放器会显示出来并停在上次的位置，用户点一下播放即可继续。
      } else {
        // —— 首次进入：默认把本地音乐填进播放器 ——
        // 这样首页音乐卡片一进站就显示播放器，而不是"点击音乐页开始播放"。
        await loadLocalSongsAsDefault(ap);
      }

      // ===== 事件监听 =====
      ap.on("play", () => {
        setIsPlaying(true);
        // 能播起来了就清掉上一次的失败提示
        setPlayError(null);
      });

      ap.on("timeupdate", () => {
        const t = ap.audio?.currentTime || 0;
        currentTimeRef.current = t;
        setCurrentTime(t);

        // 节流写盘：每 5 秒存一次进度。
        // 不做节流的话 timeupdate 大约每 250ms 触发一次，
        // localStorage 是同步写，频繁写会拖慢主线程。
        const now = Date.now();
        if (now - lastSaveAtRef.current >= 5000) {
          lastSaveAtRef.current = now;
          savePlayerState({
            playlist: playlistRef.current,
            currentIndex: ap.list.index,
            currentSong: currentSongRef.current,
            currentTime: t,
            playMode: playModeRef.current,
          });
        }
      });

      ap.on("loadedmetadata", () => {
        setDuration(ap.audio?.duration || 0);
        // 恢复上次进度：必须等元数据就绪后才能 seek，
        // 否则 currentTime 赋值会被浏览器忽略。
        const pending = pendingSeekRef.current;
        if (pending > 0) {
          pendingSeekRef.current = 0;
          try {
            ap.seek(pending);
          } catch {}
        }
      });

      // 暂停 / 页面隐藏时立刻把进度落盘，避免"关页面丢掉最后几秒"
      const flushState = () => {
        if (playlistRef.current.length === 0) return;
        savePlayerState({
          playlist: playlistRef.current,
          currentIndex: ap.list.index,
          currentSong: currentSongRef.current,
          currentTime: currentTimeRef.current,
          playMode: playModeRef.current,
        });
      };
      flushStateRef.current = flushState;
      ap.on("pause", () => {
        setIsPlaying(false);
        flushState();
      });
      window.addEventListener("pagehide", flushState);

      // APlayer 内部切歌（用户点下一首 / 播完自动下一首 / 播放失败的自动跳过）
      //
      // 关键：APlayer 的 list.switch() 实现是
      //     trigger("listswitch", {index: e});  THEN  this.index = e;
      // 事件是**在 this.index 更新之前**同步触发的。
      // 所以这里必须用回调参数里的 index，读 ap.list.index 会拿到上一个索引，
      // 导致"切到第 5 首却显示第 4 首"这类播放/显示不一致。
      ap.on("listswitch", (data) => {
        const idx = (data as { index?: number } | undefined)?.index;
        const list = playlistRef.current;
        if (typeof idx !== "number" || !list[idx]) return;
        setCurrentIndex(idx);
        setCurrentSong(list[idx]);
      });

      // 播放失败（网易云 VIP / 版权限制会让后端流返回 404，audio 报 error）。
      // APlayer 自己会在 2 秒后跳到下一首，但用户只会看到"这首没声音"，
      // 所以这里明确提示是哪首歌失败了。
      ap.on("error", () => {
        const failed = currentSongRef.current;
        if (failed) setPlayError(failed.title || "这首歌");
      });

      ap.on("ended", () => {
        const mode = playModeRef.current;
        const list = playlistRef.current;

        if (mode === "single") {
          ap.seek(0);
          ap.play();
        } else if (mode === "loop" && list.length > 1) {
          // 随机下一首；切歌后 listswitch 会同步状态，这里不用再手动 set
          const idx = Math.floor(Math.random() * list.length);
          ap.list.switch(idx);
          ap.play();
        } else {
          // 顺序播放：交给 APlayer 前进，listswitch 会同步 currentSong/currentIndex
          ap.skipForward();
          if (!ap.audio?.paused) ap.play();
        }
      });
    })();

    return () => {
      mounted = false;
      // 先移除监听，再清引用（顺序反了就移除不掉）
      if (flushStateRef.current) {
        window.removeEventListener("pagehide", flushStateRef.current);
        flushStateRef.current = null;
      }
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
  //
  // 歌单 / 当前曲 / 播放模式变化时立即存一次；
  // 进度由 timeupdate 里的节流逻辑单独负责（每 5 秒）。
  useEffect(() => {
    if (playlist.length === 0) return;
    savePlayerState({
      playlist,
      currentIndex,
      currentSong,
      currentTime: currentTimeRef.current,
      playMode,
    });
  }, [playlist, currentIndex, currentSong, playMode]);

    /* ---------- 播放指定歌曲 ---------- */
  const play = useCallback((song: Song, list?: Song[]) => {
    const ap = aplayerRef.current;
    if (!ap) return;

    const targetList = list && list.length > 0 ? list : playlistRef.current;
    const index = targetList.findIndex(
      (s) => s.id === song.id && s.source === song.source
    );
    const realIndex = index >= 0 ? index : 0;

    // 1. 先同步 ref（listswitch 回调要靠它取到最新的歌曲列表）
    playlistRef.current = targetList;

    // 2. 同步 React 状态（让顶部卡片立即更新）
    setPlaylist(targetList);
    setCurrentIndex(realIndex);
    setCurrentSong(targetList[realIndex] || song);

    // 3. 一次性清空 APlayer 列表
    while (ap.list.audios.length > 0) {
      ap.list.remove(0);
    }

    // 4. 一次性添加整个列表（APlayer 支持数组，别循环 add）
    const audios = targetList.map(toAPlayerAudio);
    ap.list.add(audios);

    // 5. 关键：用双层 requestAnimationFrame 确保列表 DOM 就绪后再播放
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
  // 状态同步统一由 listswitch 事件负责，这里只驱动 APlayer 切歌，
  // 避免两处各自 setState 造成显示与实际播放不一致。
  //
  // 注：这里读 ap.list.index 是安全的 —— 它在 list.switch() 内部、
  // 事件触发之后就被赋值。只有"在 listswitch 回调里"读它才会拿到旧值。
  const next = useCallback(() => {
    const ap = aplayerRef.current;
    if (!ap) return;
    const list = playlistRef.current;
    if (list.length === 0) return;
    const newIndex = (ap.list.index + 1) % list.length;
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
    ap.list.switch(newIndex);
    setTimeout(() => ap.play(), 50);
  }, []);

  /* ---------- 进度跳转 ---------- */
  const seek = useCallback((time: number) => {
    aplayerRef.current?.seek(time);
    // 同步 ref，避免"刚拖完进度条就关页面"时存的是旧位置
    currentTimeRef.current = time;
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
    // listswitch 会同步 currentIndex / currentSong
    ap.list.switch(index);
    ap.play();
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
    currentTimeRef.current = 0;
    pendingSeekRef.current = 0;
    localStorage.removeItem(PLAYER_STATE_KEY);
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

  const clearPlayError = useCallback(() => setPlayError(null), []);

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
    playError,
    clearPlayError,
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