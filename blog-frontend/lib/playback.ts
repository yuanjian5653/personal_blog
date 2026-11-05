/**
 * 播放模式的纯逻辑（不依赖 APlayer、不依赖 React，可单元测试）。
 *
 * 为什么单独抽出来：
 *   之前的模式逻辑散在三个地方 —— PlayerProvider 的 ended 回调、
 *   PlayerControls 的 cycleMode、PlayerBar 的 cycleMode 与文字表，
 *   三处各写一遍且互相矛盾（有的把 loop 当"随机"，有的把 order 当"随机"）。
 *   现在统一到这里：模式枚举、循环顺序、图标/文案对应、下一首索引计算，
 *   调用方只消费结果。
 *
 * 四种模式的语义（与现有界面文案对齐）：
 *   order    顺序播放 —— 播到最后一首就停
 *   loop     列表循环 —— 播完最后一首回到第一首
 *   single   单曲循环 —— 一直重复当前这首
 *   shuffle  随机播放 —— 随机跳到另一首（不会连着重复同一首）
 *
 * 说明：旧版本里 "loop" 实际执行的是随机下一首，本次修正为真正的列表循环，
 * 并把随机拆成独立的 "shuffle"。已存的存档如果是 "loop"，会变成列表循环。
 */

export type PlayMode = "order" | "loop" | "single" | "shuffle";

/** 点击模式按钮时的循环顺序 */
export const PLAY_MODE_CYCLE: PlayMode[] = [
  "order",
  "loop",
  "single",
  "shuffle",
];

/** 完整文案（用于 title / aria-label） */
export const PLAY_MODE_LABEL: Record<PlayMode, string> = {
  order: "顺序播放",
  loop: "列表循环",
  single: "单曲循环",
  shuffle: "随机播放",
};

/** 简短文案（用于底栏那种窄按钮） */
export const PLAY_MODE_SHORT: Record<PlayMode, string> = {
  order: "顺序",
  loop: "循环",
  single: "单曲",
  shuffle: "随机",
};

/** 把任意（可能来自旧存档的）值规整成合法模式 */
export function normalizeMode(value: unknown): PlayMode {
  return value === "loop" || value === "single" || value === "shuffle"
    ? value
    : "order";
}

/** 点一下模式按钮后的下一个模式 */
export function cyclePlayMode(mode: PlayMode): PlayMode {
  const idx = PLAY_MODE_CYCLE.indexOf(mode);
  return PLAY_MODE_CYCLE[(idx + 1) % PLAY_MODE_CYCLE.length];
}

/**
 * 在 [0, length) 里随机取一个**不等于 current** 的索引。
 * length <= 1 时只能返回 current。
 * rand 可注入，方便测试。
 */
function randomOther(
  current: number,
  length: number,
  rand: () => number
): number {
  if (length <= 1) return Math.max(0, Math.min(current, length - 1));
  // 在 length-1 个候选里挑一个，再跳过 current —— 保证不会重复当前曲
  const pick = Math.floor(rand() * (length - 1));
  return pick >= current ? pick + 1 : pick;
}

/**
 * 手动点「下一首」时的目标索引。
 * 列表为空返回 -1。
 *
 * 注意：手动切歌时**总是**循环（除了单曲循环），
 * 否则在顺序播放的最后一首按下一首会变成"停止"，很反直觉。
 */
export function nextIndex(
  mode: PlayMode,
  current: number,
  length: number,
  rand: () => number = Math.random
): number {
  if (length <= 0) return -1;
  const cur = Math.min(Math.max(current, 0), length - 1);

  switch (mode) {
    case "single":
      return cur;
    case "shuffle":
      return randomOther(cur, length, rand);
    default:
      return (cur + 1) % length;
  }
}

/**
 * 手动点「上一首」时的目标索引。
 * 列表为空返回 -1。
 *
 * 随机模式下也返回随机另一首 —— 因为没有维护播放历史，
 * 与其假装"上一首"是历史里的上一首，不如保持一致的手感。
 */
export function prevIndex(
  mode: PlayMode,
  current: number,
  length: number,
  rand: () => number = Math.random
): number {
  if (length <= 0) return -1;
  const cur = Math.min(Math.max(current, 0), length - 1);

  switch (mode) {
    case "single":
      return cur;
    case "shuffle":
      return randomOther(cur, length, rand);
    default:
      return (cur - 1 + length) % length;
  }
}

/**
 * 一首歌自然播完后的目标索引。
 *
 * 与 nextIndex 的差别：顺序播放播到最后一首时返回 **-1**，
 * 表示"没有下一首了，应该停下来"。
 * （旧实现里顺序播放也会无限循环，导致"顺序"和"循环"没有区别。）
 */
export function autoNextIndex(
  mode: PlayMode,
  current: number,
  length: number,
  rand: () => number = Math.random
): number {
  if (length <= 0) return -1;
  const cur = Math.min(Math.max(current, 0), length - 1);

  switch (mode) {
    case "single":
      return cur;
    case "shuffle":
      return randomOther(cur, length, rand);
    case "loop":
      return (cur + 1) % length;
    case "order":
      return cur + 1 < length ? cur + 1 : -1;
  }
}
