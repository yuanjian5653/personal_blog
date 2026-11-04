/**
 * lib/cache 的测试（无需浏览器，用替换 api.get 的方式验证）。
 *
 * 这层缓存是为了解决"切走再切回来又要重新请求"：
 * App Router 会卸载页面组件，切回时 useEffect 重新跑。
 * 所以必须保证：
 *   1. 同一 path 的第二次调用**不再打请求**
 *   2. 并发调用只打一个请求（in-flight 去重）
 *   3. 过期后会重新请求
 *   4. 不同 path 互不影响
 *   5. invalidate / clear 能生效
 *
 * 用法：
 *   node --experimental-strip-types --loader ./scripts/ts-resolve-hook.mjs \
 *        scripts/test-cache.mjs
 */
import { api } from "../lib/api.ts";
import {
  cachedGet,
  clearCachedGets,
  invalidateCached,
  peekCached,
} from "../lib/cache.ts";

let passed = 0;
const fails = [];

function ok(label, cond, extra = "") {
  if (cond) {
    passed += 1;
    console.log(`  [OK ] ${label}`);
  } else {
    fails.push(`${label} ${extra}`);
    console.log(`  [FAIL] ${label} ${extra}`);
  }
}

function eq(label, got, want) {
  const a = JSON.stringify(got);
  const b = JSON.stringify(want);
  ok(label, a === b, a === b ? "" : `got=${a} want=${b}`);
}

/** 统计被真实请求了多少次 */
let calls = 0;
const calledPaths = [];

api.get = async (path) => {
  calls += 1;
  calledPaths.push(path);
  return { path, n: calls };
};

function reset() {
  calls = 0;
  calledPaths.length = 0;
  clearCachedGets();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log("=== 1. 首次请求 + 二次命中缓存 ===");
reset();
{
  const a = await cachedGet("/api/x");
  eq("第一次拿到数据", a.path, "/api/x");
  eq("第一次打了 1 个请求", calls, 1);

  const b = await cachedGet("/api/x");
  eq("第二次数据一致", b.path, "/api/x");
  eq("第二次没有再打请求", calls, 1);
  ok("返回的是同一份缓存对象", a === b);
}

console.log("\n=== 2. 并发去重：同时发起 5 次只打 1 个请求 ===");
reset();
{
  const results = await Promise.all([
    cachedGet("/api/y"),
    cachedGet("/api/y"),
    cachedGet("/api/y"),
    cachedGet("/api/y"),
    cachedGet("/api/y"),
  ]);
  eq("5 次调用只打 1 个请求", calls, 1);
  ok(
    "5 次拿到同一个对象",
    results.every((r) => r === results[0]),
    JSON.stringify(results.map((r) => r.n))
  );
}

console.log("\n=== 3. 不同 path 互不影响 ===");
reset();
{
  await cachedGet("/api/a");
  await cachedGet("/api/b");
  eq("两个不同 path 各打一次", calls, 2);
  eq("记录到的 path", calledPaths, ["/api/a", "/api/b"]);

  await cachedGet("/api/a");
  eq("再取 /api/a 仍命中缓存", calls, 2);
}

console.log("\n=== 4. TTL 过期后重新请求 ===");
reset();
{
  await cachedGet("/api/ttl", 30);
  eq("首次 1 次请求", calls, 1);
  await sleep(60);
  await cachedGet("/api/ttl", 30);
  eq("过期后重新请求（共 2 次）", calls, 2);
}

console.log("\n=== 5. peekCached 同步读取 ===");
reset();
{
  eq("未请求时 peek 为 null", peekCached("/api/p"), null);
  await cachedGet("/api/p");
  const hit = peekCached("/api/p");
  ok("请求后 peek 能拿到", hit !== null && hit.path === "/api/p");
  eq("peek 不产生额外请求", calls, 1);
  eq("ttl=0 时 peek 视为过期", peekCached("/api/p", 0), null);
}

console.log("\n=== 6. invalidate / clear ===");
reset();
{
  await cachedGet("/api/inv");
  eq("首次 1 次", calls, 1);
  invalidateCached("/api/inv");
  await cachedGet("/api/inv");
  eq("失效后重新请求（2 次）", calls, 2);

  clearCachedGets();
  await cachedGet("/api/inv");
  eq("清空后重新请求（3 次）", calls, 3);
}

console.log("\n=== 7. 失败不写缓存（下次仍会重试）===");
reset();
{
  let fail = true;
  api.get = async (path) => {
    calls += 1;
    if (fail) throw new Error("boom");
    return { path, ok: true };
  };

  let threw = false;
  try {
    await cachedGet("/api/fail");
  } catch {
    threw = true;
  }
  ok("首次失败会抛出", threw);
  eq("失败也消耗了 1 次请求", calls, 1);
  eq("失败后没有写入缓存", peekCached("/api/fail"), null);

  fail = false;
  const r = await cachedGet("/api/fail");
  eq("重试成功", r.ok, true);
  eq("共 2 次请求", calls, 2);
}

console.log();
if (fails.length) {
  console.log(`[失败] ${fails.length} 项不通过：`);
  for (const f of fails) console.log("  -", f);
  process.exit(1);
}
console.log(`[通过] GET 缓存全部 ${passed} 项断言通过`);
