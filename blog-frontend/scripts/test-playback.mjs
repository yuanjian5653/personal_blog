/**
 * lib/playback.ts 的单元测试
 *
 * 为什么要测：播放模式的分支（顺序/列表循环/单曲/随机）平时很难手动覆盖 ——
 * 要等一首歌真的播完才能验证 ended 分支，而且随机模式无法断言"不会重复"。
 * 这里用注入的 rand 把随机变成确定值，把四种模式 × 边界全部固定下来。
 *
 * 运行：
 *   node --experimental-strip-types --loader ./scripts/ts-resolve-hook.mjs \
 *        scripts/test-playback.mjs
 */
import {
  autoNextIndex,
  cyclePlayMode,
  nextIndex,
  normalizeMode,
  prevIndex,
  PLAY_MODE_CYCLE,
  PLAY_MODE_LABEL,
  PLAY_MODE_SHORT,
} from "../lib/playback.ts";

let passed = 0;
const failures = [];

function eq(actual, expected, label) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) {
    passed += 1;
  } else {
    failures.push(`${label}\n      期望 ${b}\n      实际 ${a}`);
  }
}

/* ---------- 1. cyclePlayMode：四种模式循环一圈回到原点 ---------- */
eq(cyclePlayMode("order"), "loop", "order → loop");
eq(cyclePlayMode("loop"), "single", "loop → single");
eq(cyclePlayMode("single"), "shuffle", "single → shuffle");
eq(cyclePlayMode("shuffle"), "order", "shuffle → order（回到起点）");
{
  let m = "order";
  for (let i = 0; i < PLAY_MODE_CYCLE.length; i += 1) m = cyclePlayMode(m);
  eq(m, "order", "循环 4 次回到 order");
}

/* ---------- 2. normalizeMode：容错 ---------- */
eq(normalizeMode("order"), "order", "normalize order");
eq(normalizeMode("loop"), "loop", "normalize loop");
eq(normalizeMode("single"), "single", "normalize single");
eq(normalizeMode("shuffle"), "shuffle", "normalize shuffle");
eq(normalizeMode(undefined), "order", "normalize undefined → order");
eq(normalizeMode("垃圾值"), "order", "normalize 非法值 → order");
eq(normalizeMode(null), "order", "normalize null → order");

/* ---------- 3. nextIndex：手动下一首 ---------- */
const N = 5;
eq(nextIndex("order", 0, N), 1, "order 0→1");
eq(nextIndex("order", 4, N), 0, "order 最后一首 → 绕回第一首（手动切歌总是循环）");
eq(nextIndex("loop", 4, N), 0, "loop 最后一首 → 绕回");
eq(nextIndex("single", 2, N), 2, "single 保持当前曲");
eq(nextIndex("order", 0, 0), -1, "空列表 → -1");
eq(nextIndex("order", 0, 1), 0, "单曲列表 → 0");
eq(nextIndex("order", 99, N), 0, "越界索引被夹紧后 → 1%（结果 (4+1)%5=0）");

// 随机：注入固定 rand，验证"不会等于当前曲"
eq(nextIndex("shuffle", 2, N, () => 0), 0, "shuffle rand=0 且 current=2 → 0");
eq(nextIndex("shuffle", 0, N, () => 0), 1, "shuffle rand=0 且 current=0 → 1（跳过自己）");
eq(nextIndex("shuffle", 4, N, () => 0.999), 3, "shuffle 末尾 rand≈1 → 3（跳过自己）");
eq(nextIndex("shuffle", 3, 1, () => 0.5), 0, "shuffle 单曲列表 → 0");

// 随机模式：任意 rand 都不能返回当前曲
{
  let bad = 0;
  for (let i = 0; i < 200; i += 1) {
    const cur = i % N;
    if (nextIndex("shuffle", cur, N) === cur) bad += 1;
  }
  eq(bad, 0, "shuffle 200 次随机，从未返回当前曲");
}

/* ---------- 4. prevIndex ---------- */
eq(prevIndex("order", 0, N), 4, "order 第一首 → 绕到末尾");
eq(prevIndex("order", 3, N), 2, "order 3→2");
eq(prevIndex("single", 2, N), 2, "single 保持当前曲");
eq(prevIndex("order", 0, 0), -1, "空列表 → -1");
eq(prevIndex("shuffle", 0, N, () => 0), 1, "shuffle prev 也不会等于自己");

/* ---------- 5. autoNextIndex：播完自动续播 ---------- */
eq(autoNextIndex("order", 0, N), 1, "顺序 0→1");
eq(autoNextIndex("order", 3, N), 4, "顺序 3→4（还没到末尾）");
eq(autoNextIndex("order", 4, N), -1, "顺序播到最后一首 → -1（应当停止）");
eq(autoNextIndex("loop", 4, N), 0, "列表循环 最后一首 → 0");
eq(autoNextIndex("single", 2, N), 2, "单曲循环 → 同一首");
eq(autoNextIndex("shuffle", 2, N, () => 0), 0, "随机 → 跳过自己");
eq(autoNextIndex("order", 0, 0), -1, "空列表 → -1");
eq(autoNextIndex("loop", 0, 1), 0, "单曲列表 loop → 0");

// 关键差异：order 到末尾返回 -1，loop 返回 0
eq(
  [autoNextIndex("order", N - 1, N), autoNextIndex("loop", N - 1, N)],
  [-1, 0],
  "末尾处 order 停止、loop 绕回（这正是旧实现区分不出来的地方）"
);

/* ---------- 6. 文案表完整性 ---------- */
for (const m of PLAY_MODE_CYCLE) {
  eq(typeof PLAY_MODE_LABEL[m], "string", `PLAY_MODE_LABEL 有 ${m}`);
  eq(typeof PLAY_MODE_SHORT[m], "string", `PLAY_MODE_SHORT 有 ${m}`);
}
eq(Object.keys(PLAY_MODE_LABEL).length, 4, "PLAY_MODE_LABEL 恰好 4 项");
eq(Object.keys(PLAY_MODE_SHORT).length, 4, "PLAY_MODE_SHORT 恰好 4 项");

/* ---------- 输出 ---------- */
console.log(`\n[${failures.length === 0 ? "通过" : "失败"}] 播放模式逻辑 ${passed} 项断言`);
if (failures.length > 0) {
  for (const f of failures) console.log("  ✗ " + f);
  process.exit(1);
}
