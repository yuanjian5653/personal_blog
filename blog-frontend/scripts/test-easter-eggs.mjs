/**
 * lib/easterEggs.ts 的纯函数测试。
 *
 * 只测不依赖浏览器的部分：暗号归一化、匹配、"关闭"暗号、注册表完整性，
 * 以及 submitCode 的判定分支（Node 里没有 window，所以不会真的写 localStorage，
 * 这正好让我们能安全地测返回值类型）。
 *
 * 运行：
 *   node --experimental-strip-types --loader ./scripts/ts-resolve-hook.mjs \
 *        scripts/test-easter-eggs.mjs
 */
import {
  EASTER_EGGS,
  EGG_OFF_CODES,
  findEgg,
  isOffCode,
  normalizeCode,
  submitCode,
} from "../lib/easterEggs.ts";

let passed = 0;
const failures = [];

function eq(actual, expected, label) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) passed += 1;
  else failures.push(`${label}\n      期望 ${b}\n      实际 ${a}`);
}

/* ---------- 1. normalizeCode ---------- */
eq(normalizeCode("星空"), "星空", "中文原样");
eq(normalizeCode("  星空  "), "星空", "去首尾空格");
eq(normalizeCode("STARS"), "stars", "转小写");
eq(normalizeCode("St ars"), "stars", "去掉中间空格");
eq(normalizeCode(""), "", "空串");
eq(normalizeCode("　星空　"), "星空", "全角空格也算空白");
// 全角字母 → 半角
eq(normalizeCode("ＳＴＡＲＳ"), "stars", "全角字母转半角");

/* ---------- 2. findEgg ---------- */
eq(findEgg("星空")?.id, "stars", "中文暗号");
eq(findEgg("  星空 ")?.id, "stars", "带空格也能认");
eq(findEgg("STARS")?.id, "stars", "大写英文别名");
eq(findEgg("star")?.id, "stars", "单数英文");
eq(findEgg("xingkong")?.id, "stars", "拼音");
eq(findEgg("游戏")?.id, "game", "游戏暗号");
eq(findEgg("GAME")?.id, "game", "游戏英文");
eq(findEgg("随便打的") ?? null, null, "错的暗号返回 null");
eq(findEgg("") ?? null, null, "空串返回 null");
eq(findEgg("   ") ?? null, null, "全空格返回 null");

/* ---------- 3. 关闭暗号 ---------- */
eq(isOffCode("关闭"), true, "关闭");
eq(isOffCode("关掉"), true, "关掉");
eq(isOffCode("OFF"), true, "OFF");
eq(isOffCode("close"), true, "close");
eq(isOffCode("星空"), false, "星空不是关闭暗号");
eq(isOffCode(""), false, "空串不是关闭暗号");

/* ---------- 4. submitCode 分支 ---------- */
eq(submitCode("星空").type, "effect", "星空 → effect");
eq(submitCode("游戏").type, "game", "游戏 → game");
eq(submitCode("关闭").type, "off", "关闭 → off");
eq(submitCode("不存在的暗号").type, "unknown", "未知 → unknown");
eq(submitCode("").type, "unknown", "空串 → unknown");

// 解锁 effect 时要把 egg 带回来（前端要靠它显示名字和提示）
const unlocked = submitCode("星空");
eq(unlocked.type === "effect" ? unlocked.egg.name : null, "星空", "结果里带名字");
eq(
  unlocked.type === "effect" ? unlocked.egg.hint.length > 0 : false,
  true,
  "结果里带提示语"
);

/* ---------- 5. 注册表完整性 ---------- */
eq(new Set(EASTER_EGGS.map((e) => e.id)).size, EASTER_EGGS.length, "id 不重复");
eq(
  EASTER_EGGS.every((e) => e.codes.length > 0),
  true,
  "每个彩蛋至少一个暗号"
);
eq(
  EASTER_EGGS.every((e) => e.codes.every((c) => normalizeCode(c).length > 0)),
  true,
  "所有暗号归一化后非空"
);
eq(
  EASTER_EGGS.every((e) => e.name.length > 0 && e.hint.length > 0),
  true,
  "名字和提示都不为空"
);
eq(
  EASTER_EGGS.every((e) => e.kind === "effect" || e.kind === "game"),
  true,
  "kind 只有两种取值"
);
// 防止同一个暗号被两个彩蛋抢走（findEgg 只会返回第一个）
const allCodes = EASTER_EGGS.flatMap((e) => e.codes.map(normalizeCode));
eq(
  new Set(allCodes).size,
  allCodes.length,
  "不同彩蛋的暗号不冲突"
);
// "关闭"类暗号不能和彩蛋暗号撞
const offNormalized = EGG_OFF_CODES.map(normalizeCode);
eq(
  offNormalized.some((c) => allCodes.includes(c)),
  false,
  "关闭暗号不与彩蛋暗号冲突"
);

/* ---------- 输出 ---------- */
console.log(
  `\n[${failures.length === 0 ? "通过" : "失败"}] 暗号与彩蛋 ${passed} 项断言`
);
if (failures.length > 0) {
  for (const f of failures) console.log("  ✗ " + f);
  process.exit(1);
}
