/**
 * lib/easterEggs.ts 的纯函数测试。
 *
 * 暗号已经从"前端写死的注册表"改成"后端可管理"，
 * 所以这里只测不依赖网络的归一化与"关闭"暗号判断；
 * 匹配逻辑（code → egg）在后端，由 scripts/test_easter_eggs.py 覆盖。
 *
 * 运行：
 *   node --experimental-strip-types --loader ./scripts/ts-resolve-hook.mjs \
 *        scripts/test-easter-eggs.mjs
 */
import {
  EGG_OFF_CODES,
  EGG_STORAGE_KEY,
  isOffCode,
  normalizeCode,
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
eq(normalizeCode("St ars"), "stars", "去中间空格 + 小写");
eq(normalizeCode("STARS"), "stars", "转小写");
eq(normalizeCode(""), "", "空串");
eq(normalizeCode("　星空　"), "星空", "全角空格也算空白");
eq(normalizeCode("ＳＴＡＲＳ"), "stars", "全角字母转半角");

/* ---------- 2. 关闭暗号 ---------- */
eq(isOffCode("关闭"), true, "关闭");
eq(isOffCode("关掉"), true, "关掉");
eq(isOffCode("OFF"), true, "OFF 大写");
eq(isOffCode(" close "), true, "带空格的 close");
eq(isOffCode("reset"), true, "reset");
eq(isOffCode("星空"), false, "星空不是关闭暗号");
eq(isOffCode(""), false, "空串不是关闭暗号");
eq(isOffCode("   "), false, "全空格不是关闭暗号");

/* ---------- 3. 常量完整性 ---------- */
eq(EGG_OFF_CODES.length > 0, true, "关闭暗号列表非空");
eq(
  EGG_OFF_CODES.every((c) => normalizeCode(c).length > 0),
  true,
  "每个关闭暗号归一化后非空"
);
eq(
  new Set(EGG_OFF_CODES.map(normalizeCode)).size,
  EGG_OFF_CODES.length,
  "关闭暗号彼此不重复"
);
eq(typeof EGG_STORAGE_KEY, "string", "存储 key 是字符串");
eq(EGG_STORAGE_KEY.length > 0, true, "存储 key 非空");
// 换了存储 key 会让所有老用户的效果一次性失效，所以断言它带版本号
eq(EGG_STORAGE_KEY.endsWith(":v2"), true, "存储 key 带版本号（v2）");

/* ---------- 输出 ---------- */
console.log(
  `\n[${failures.length === 0 ? "通过" : "失败"}] 暗号归一化与关闭 ${passed} 项断言`
);
if (failures.length > 0) {
  for (const f of failures) console.log("  ✗ " + f);
  process.exit(1);
}
