"use client";

/**
 * 首页搜索框的「暗号」系统。
 *
 * 设计意图：搜索框本来只是装饰，现在把它做成一个入口 ——
 * 输入特定暗号可以解锁彩蛋（背景星空之类），以后还能挂小游戏。
 *
 * 三个原则：
 * 1. **暗号大小写/空格无关**，也支持拼音式的英文别名，免得用户纠结写法
 * 2. **效果状态存 localStorage**，刷新后仍然生效（不然每次进站都要重输）
 * 3. **一定留一个"关闭"暗号**，否则用户开了效果却找不到关的地方
 */

export type EggKind = "effect" | "game";

export interface EasterEgg {
  id: string;
  /** 可用的暗号（全部会做归一化比较） */
  codes: string[];
  name: string;
  /** 解锁后的提示语 */
  hint: string;
  kind: EggKind;
  /** 是否记住（刷新后仍然生效） */
  sticky: boolean;
}

export const EASTER_EGGS: EasterEgg[] = [
  {
    id: "stars",
    codes: ["星空", "stars", "star", "xingkong"],
    name: "星空",
    hint: "抬头看看 —— 背景多了星星点点",
    kind: "effect",
    sticky: true,
  },
  {
    id: "game",
    codes: ["游戏", "game", "play", "youxi"],
    name: "小游戏",
    hint: "小游戏还没定类型（想做哪个跟我说），先把入口留着",
    kind: "game",
    sticky: false,
  },
];

/** 关闭所有效果的暗号 */
export const EGG_OFF_CODES = ["关闭", "关掉", "off", "close", "reset"];

export const EGG_STORAGE_KEY = "blog:easter-eggs";
/** 状态变化事件：搜索框、宿主组件之间靠它同步 */
export const EGG_EVENT = "easter-egg-change";

/** 暗号归一化：去空格、转小写、全角转半角（中文暗号不受影响） */
export function normalizeCode(raw: string): string {
  return raw
    .replace(/[\uFF01-\uFF5E]/g, (ch) =>
      String.fromCharCode(ch.charCodeAt(0) - 0xfee0)
    )
    .replace(/\s+/g, "")
    .toLowerCase();
}

export function findEgg(raw: string): EasterEgg | null {
  const code = normalizeCode(raw);
  if (!code) return null;
  return EASTER_EGGS.find((e) => e.codes.some((c) => normalizeCode(c) === code)) ?? null;
}

export function isOffCode(raw: string): boolean {
  const code = normalizeCode(raw);
  return !!code && EGG_OFF_CODES.some((c) => normalizeCode(c) === code);
}

/* ---------------- 已解锁状态 ---------------- */

/**
 * 给 useSyncExternalStore 用的快照。
 *
 * **必须返回稳定引用**：每次调用都新建数组的话，React 会判定"变了"，
 * 从而无限重渲染。所以这里按 localStorage 的原始字符串做缓存 ——
 * 内容没变就返回同一个数组。
 */
const EMPTY_EGGS: string[] = [];
let snapshotCache: string[] = EMPTY_EGGS;
let snapshotRaw: string | null = null;

export function getEggsSnapshot(): string[] {
  if (typeof window === "undefined") return EMPTY_EGGS;
  let raw = "";
  try {
    raw = window.localStorage.getItem(EGG_STORAGE_KEY) ?? "";
  } catch {
    return EMPTY_EGGS;
  }
  if (raw === snapshotRaw) return snapshotCache;
  snapshotRaw = raw;
  snapshotCache = parseEggs(raw);
  return snapshotCache;
}

/** 服务端/首帧用的空快照（引用稳定） */
export function getEggsServerSnapshot(): string[] {
  return EMPTY_EGGS;
}

/** 把 localStorage 里的原始串解析成合法 id 列表 */
function parseEggs(raw: string): string[] {
  if (!raw) return EMPTY_EGGS;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return EMPTY_EGGS;
    const ids = parsed.filter(
      (id): id is string =>
        typeof id === "string" && EASTER_EGGS.some((e) => e.id === id)
    );
    return ids.length ? ids : EMPTY_EGGS;
  } catch {
    return EMPTY_EGGS;
  }
}

export function readActiveEggs(): string[] {
  return getEggsSnapshot();
}

function writeActiveEggs(ids: string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(EGG_STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // 隐私模式下写不进去就算了，效果只在本页生效
  }
  window.dispatchEvent(new Event(EGG_EVENT));
}

export function activateEgg(id: string): void {
  const eggs = readActiveEggs();
  if (eggs.includes(id)) return;
  writeActiveEggs([...eggs, id]);
}

export function deactivateEgg(id: string): void {
  writeActiveEggs(readActiveEggs().filter((x) => x !== id));
}

export function deactivateAll(): void {
  writeActiveEggs([]);
}

export function subscribeEggs(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(EGG_EVENT, cb);
  return () => window.removeEventListener(EGG_EVENT, cb);
}

/* ---------------- 输入暗号 ---------------- */

export type UnlockResult =
  | { type: "effect"; egg: EasterEgg }
  | { type: "game"; egg: EasterEgg }
  | { type: "off" }
  | { type: "unknown" };

/** 处理一次暗号输入（搜索框回车时调用） */
export function submitCode(raw: string): UnlockResult {
  const code = normalizeCode(raw);
  if (!code) return { type: "unknown" };

  if (isOffCode(code)) {
    deactivateAll();
    return { type: "off" };
  }

  const egg = findEgg(code);
  if (!egg) return { type: "unknown" };

  if (egg.kind === "game") {
    // 游戏还没做，先不记录状态
    return { type: "game", egg };
  }

  activateEgg(egg.id);
  return { type: "effect", egg };
}
