/**
 * APlayer 的最小类型声明。
 *
 * APlayer 是运行时从 CDN 动态加载的全局脚本（见 PlayerProvider 的 loadAPlayer），
 * 没有随包安装，所以官方类型用不上。这里只声明我们实际用到的 API，
 * 目的是去掉 PlayerProvider 里的 `any`，让调用处有类型检查。
 */

/** 喂给 APlayer 的单条音频 */
export interface APlayerAudio {
  name: string;
  artist: string;
  url: string;
  cover: string;
  /** 歌词内容；本项目交给 TextCard 自行渲染，这里固定为空串 */
  lrc: string;
  theme?: string;
}

/** APlayer 的播放列表对象 */
export interface APlayerList {
  /** 当前播放项在列表中的下标 */
  index: number;
  /** 当前列表里的音频 */
  audios: APlayerAudio[];
  /** 追加一条/一批音频 */
  add(audio: APlayerAudio | APlayerAudio[]): void;
  /** 移除指定下标的音频 */
  remove(index: number): void;
  /** 切到指定下标 */
  switch(index: number): void;
}

/** APlayer 实例 */
export interface APlayerInstance {
  /** 内部的 HTMLAudioElement，可能尚未创建 */
  audio?: HTMLAudioElement;
  list: APlayerList;
  play(): void;
  pause(): void;
  seek(time: number): void;
  /** 第二参数 quiet=true 表示不触发音量变化事件 */
  volume(value: number, quiet?: boolean): void;
  /** 切到下一首 */
  skipForward(): void;
  destroy(): void;
  on(event: string, handler: (...args: unknown[]) => void): void;
}

/** APlayer 构造函数 */
export type APlayerConstructor = new (options: {
  container: HTMLElement;
  audio: APlayerAudio[];
  listFolded?: boolean;
  mini?: boolean;
  theme?: string;
  volume?: number;
  mutex?: boolean;
  preload?: string;
}) => APlayerInstance;

declare global {
  interface Window {
    APlayer?: APlayerConstructor;
  }
}

export {};
