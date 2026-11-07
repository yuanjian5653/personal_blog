"use client";

/**
 * 首页搜索框的「暗号」系统（已改为后台可管理）。
 *
 * 与第一版的区别：
 *   · 暗号不再写死在前端，改成向后端 `POST /api/easter-eggs/check` 校验。
 *     前端**拿不到暗号列表**（后端公开接口刻意不返回 code），只能猜。
 *   · 解锁后把"效果描述"整体存进 localStorage（名字、类型、壁纸地址、过渡动效），
 *     因为下次进站不可能再有暗号来换这些信息。
 */

export interface EggEffect {
  egg_id: number;
  name: string;
  hint: string | null;
  /** background / stars / game */
  kind: string;
  /** 壁纸地址（/media/wallpapers/xxx.mp4），可能为空 */
  asset_path: string | null;
  /** video / image */
  asset_kind: string | null;
  /** fade / zoom / slide / blur */
  transition: string;
}

export const EGG_STORAGE_KEY = "blog:easter-eggs:v2";
export const EGG_EVENT = "easter-egg-change";
/** 游戏类彩蛋被解锁时广播（宿主据此打开游戏；不写 localStorage） */
export const EGG_GAME_EVENT = "easter-egg-game";

/** 关闭所有效果的暗号（固定的，不需要后台配置） */
export const EGG_OFF_CODES = ["关闭", "关掉", "off", "close", "reset"];

export function normalizeCode(raw: string): string {
  return raw
    .replace(/[\uFF01-\uFF5E]/g, (ch) =>
      String.fromCharCode(ch.charCodeAt(0) - 0xfee0)
    )
    .replace(/\s+/g, "")
    .toLowerCase();
}

export function isOffCode(raw: string): boolean {
  const code = normalizeCode(raw);
  return !!code && EGG_OFF_CODES.some((c) => normalizeCode(c) === code);
}

/* ---------------- 已解锁状态 ---------------- */

const EMPTY: EggEffect[] = [];
let cache: EggEffect[] = EMPTY;
let cacheRaw: string | null = null;

function parse(raw: string): EggEffect[] {
  if (!raw) return EMPTY;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return EMPTY;
    const list = parsed.filter(
      (e): e is EggEffect =>
        !!e &&
        typeof e === "object" &&
        typeof (e as EggEffect).egg_id === "number" &&
        typeof (e as EggEffect).kind === "string"
    );
    return list.length ? list : EMPTY;
  } catch {
    return EMPTY;
  }
}

/** 给 useSyncExternalStore 用：内容没变必须返回同一个引用，否则会无限重渲染 */
export function getEggsSnapshot(): EggEffect[] {
  if (typeof window === "undefined") return EMPTY;
  let raw = "";
  try {
    raw = window.localStorage.getItem(EGG_STORAGE_KEY) ?? "";
  } catch {
    return EMPTY;
  }
  if (raw === cacheRaw) return cache;
  cacheRaw = raw;
  cache = parse(raw);
  return cache;
}

export function getEggsServerSnapshot(): EggEffect[] {
  return EMPTY;
}

function write(eggs: EggEffect[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(EGG_STORAGE_KEY, JSON.stringify(eggs));
  } catch {
    // 隐私模式写不进去就只在本页生效
  }
  window.dispatchEvent(new Event(EGG_EVENT));
}

export function deactivateAll(): void {
  write([]);
}

export function deactivateEgg(eggId: number): void {
  write(getEggsSnapshot().filter((e) => e.egg_id !== eggId));
}

export function subscribeEggs(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(EGG_EVENT, cb);
  return () => window.removeEventListener(EGG_EVENT, cb);
}

/* ---------------- 校验暗号 ---------------- */

export type UnlockResult =
  | { type: "effect"; egg: EggEffect }
  | { type: "game"; egg: EggEffect }
  | { type: "off" }
  | { type: "unknown" };

/**
 * 提交暗号。命中后：
 *   · 背景类 → 存进 localStorage，宿主渲染壁纸/星空
 *   · 游戏类 → 也存下来，宿主据此打开游戏
 */
export async function submitCode(raw: string): Promise<UnlockResult> {
  const code = raw.trim();
  if (!code) return { type: "unknown" };

  if (isOffCode(code)) {
    deactivateAll();
    return { type: "off" };
  }

  let egg: EggEffect;
  try {
    const base = (
      process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000"
    ).replace(/\/$/, "");
    const res = await fetch(`${base}/api/easter-eggs/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    if (!res.ok) return { type: "unknown" };
    egg = (await res.json()) as EggEffect;
  } catch {
    return { type: "unknown" };
  }

  // 游戏类**不持久化**：它是一次性动作，存下来会导致每次刷新都弹游戏窗口。
  // 改成广播一个事件，宿主接住就打开；关掉即结束。
  if (egg.kind === "game") {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(EGG_GAME_EVENT, { detail: egg }));
    }
    return { type: "game", egg };
  }

  // 背景类：同一个彩蛋重复解锁不重复叠加
  const current = getEggsSnapshot();
  if (!current.some((e) => e.egg_id === egg.egg_id)) {
    write([...current, egg]);
  }

  return { type: "effect", egg };
}
