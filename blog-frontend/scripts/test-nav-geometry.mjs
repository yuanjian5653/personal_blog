/**
 * 导航栏液体指示器几何的回归测试（纯函数，无需浏览器）。
 *
 * 这个测试是为了钉死一个真实发生过的 bug：
 *   `.nav-island__item` 设了 position: relative 之后，
 *   <a> 的 offsetParent 变成它自己的 <li>，`a.offsetLeft` 恒为 0，
 *   于是指示器永远停在最左端，切页面时"选中框不跟着动"。
 *
 * 修法是量 <li> 而不是 <a>。下面的用例用假对象把这件事钉住：
 * 给 <a> 和 <li> 不同的 offsetLeft，断言结果必须是 <li> 的那个。
 *
 * 用法：
 *   node --experimental-strip-types --loader ./scripts/ts-resolve-hook.mjs \
 *        scripts/test-nav-geometry.mjs
 */
import { resolveLiquidGeometry } from "../lib/navGeometry.ts";

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

/** 造一个假的可测量节点 */
function node(offsetLeft, offsetWidth, parentElement = null) {
  return { offsetLeft, offsetWidth, parentElement };
}

/** 造一个假轨道：querySelector 返回给定的活动项链接 */
function trackWith(link) {
  return {
    querySelector(sel) {
      return sel === '[data-active="true"]' ? link : null;
    },
  };
}

console.log("=== 1. 边界情况都返回 null ===");
eq("轨道为 null", resolveLiquidGeometry(null), null);
eq("轨道为 undefined", resolveLiquidGeometry(undefined), null);
eq(
  "没有活动项",
  resolveLiquidGeometry({ querySelector: () => null }),
  null
);
eq(
  "活动项宽度为 0（轨道被隐藏，两者都是 0）",
  resolveLiquidGeometry(trackWith(node(0, 0, node(0, 0)))),
  null
);
eq(
  "活动项没有父元素",
  resolveLiquidGeometry(trackWith(node(10, 20, null))),
  null
);

console.log("\n=== 2. 关键回归：必须读 <li> 的 offsetLeft，不是 <a> 的 ===");
{
  // <a> 的 offsetLeft 是 0（这就是 bug 发生时的样子），<li> 才是真实位置
  const li = node(180, 72, node(0, 0));
  const a = node(0, 72, li);
  eq("读到 li 的 offsetLeft=180 / width=72", resolveLiquidGeometry(trackWith(a)), {
    x: 180,
    w: 72,
  });

  // 反向确认：如果哪天代码改成量 <a>，这里就会拿到 0
  const wrong = resolveLiquidGeometry(trackWith(a));
  ok("结果不是 0（没有退化成量 <a>）", wrong !== null && wrong.x !== 0, JSON.stringify(wrong));
}

console.log("\n=== 3. 真实场景：11 个栏目依次成为活动项 ===");
{
  // 模拟一排等宽栏目：首页在最左，每项宽 78px、间隔 2px
  const WIDTH = 78;
  const GAP = 2;
  const items = Array.from({ length: 11 }, (_, i) =>
    node(i * (WIDTH + GAP), WIDTH, null)
  );

  const positions = [];
  for (let i = 0; i < items.length; i += 1) {
    const li = items[i];
    const a = node(0, WIDTH, li); // <a> 的 offsetLeft 永远是 0
    const geo = resolveLiquidGeometry(trackWith(a));
    positions.push(geo?.x);
  }

  eq(
    "首页在 0",
    positions[0],
    0
  );
  eq(
    "关于（第 11 项）在 800",
    positions[10],
    10 * (WIDTH + GAP)
  );

  // 位置必须严格递增：任何一个相等就说明测量没跟着活动项走
  let monotonic = true;
  for (let i = 1; i < positions.length; i += 1) {
    if (!(positions[i] > positions[i - 1])) monotonic = false;
  }
  ok("位置严格递增（选中框会跟着动）", monotonic, JSON.stringify(positions));

  // 任意两项都不能相同 —— 相同就意味着指示器没位移
  ok(
    "11 个位置互不相同",
    new Set(positions).size === positions.length,
    JSON.stringify(positions)
  );
}

console.log("\n=== 4. 宽度取自 <li>，与 <a> 无关 ===");
{
  const li = node(100, 64, null);
  const a = node(0, 999, li); // 故意给 <a> 一个错误宽度
  eq("宽度用 li 的 64", resolveLiquidGeometry(trackWith(a))?.w, 64);
}

console.log();
if (fails.length) {
  console.log(`[失败] ${fails.length} 项不通过：`);
  for (const f of fails) console.log("  -", f);
  process.exit(1);
}
console.log(`[通过] 导航指示器几何全部 ${passed} 项断言通过`);
