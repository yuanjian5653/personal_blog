/**
 * 友链卡片物理的测试（纯函数，无需浏览器）。
 *
 * 物理最容易出的三类问题：
 *   1. 越界（卡片跑出容器，或粘在边缘外面）
 *   2. 重叠（挤在一起分不开，视觉上糊成一团）
 *   3. 数值发散（速度被碰撞解算越放越大，最后瞬移）
 * 这些都适合用数值断言验证，肉眼盯动画很难发现。
 *
 * 用法：node --experimental-strip-types --loader ./scripts/ts-resolve-hook.mjs scripts/test-physics.mjs
 */
import assert from "node:assert/strict";
import {
  allInside,
  findOverlaps,
  initBodies,
  isOverlapping,
  step,
} from "../lib/physics.ts";

let pass = 0;
const failures = [];

function check(label, fn) {
  try {
    fn();
    pass++;
    console.log(`  [OK ] ${label}`);
  } catch (e) {
    failures.push(`${label}: ${e.message}`);
    console.log(`  [FAIL] ${label}`);
    console.log(`         ${e.message.split("\n")[0]}`);
  }
}

const W = 1000;
const H = 600;

function makeItems(n, r = 40) {
  return Array.from({ length: n }, (_, i) => ({ id: i + 1, r }));
}

console.log("=== 初始化 ===");
check("空列表返回空数组", () => {
  assert.deepEqual(initBodies([], W, H), []);
});

check("数量正确", () => {
  const bodies = initBodies(makeItems(8), W, H);
  assert.equal(bodies.length, 8);
});

check("初始位置全部在场地内", () => {
  const bodies = initBodies(makeItems(12, 50), W, H);
  assert.ok(allInside(bodies, W, H), "有圆初始就出界了");
});

check("初始基本不重叠", () => {
  const bodies = initBodies(makeItems(12, 50), W, H);
  const overlaps = findOverlaps(bodies);
  assert.equal(overlaps.length, 0, `初始重叠 ${overlaps.length} 对: ${JSON.stringify(overlaps)}`);
});

check("半径被正确带入", () => {
  const bodies = initBodies([{ id: 1, r: 33 }], W, H);
  assert.equal(bodies[0].r, 33);
  assert.equal(bodies[0].mass, 33 * 33);
});

check("同样的输入产生同样的初始位置（确定性）", () => {
  const a = initBodies(makeItems(10, 40), W, H);
  const b = initBodies(makeItems(10, 40), W, H);
  assert.deepEqual(
    a.map((x) => [x.x, x.y]),
    b.map((x) => [x.x, x.y]),
    "两次初始化位置不一致（用了 Math.random？）"
  );
});

console.log("\n=== 长时间运行：不越界、不发散 ===");
check("跑 600 帧后依然全在场地内", () => {
  const bodies = initBodies(makeItems(10, 45), W, H);
  for (let i = 0; i < 600; i++) step(bodies, W, H);
  assert.ok(allInside(bodies, W, H), "有圆跑出界了");
});

check("跑 600 帧后没有重叠", () => {
  const bodies = initBodies(makeItems(10, 45), W, H);
  for (let i = 0; i < 600; i++) step(bodies, W, H);
  const overlaps = findOverlaps(bodies);
  assert.equal(overlaps.length, 0, `残留 ${overlaps.length} 对重叠`);
});

check("速度始终被限制住（不会发散）", () => {
  const bodies = initBodies(makeItems(14, 50), W, H);
  let maxSeen = 0;
  for (let i = 0; i < 800; i++) {
    step(bodies, W, H);
    for (const b of bodies) maxSeen = Math.max(maxSeen, Math.hypot(b.vx, b.vy));
  }
  assert.ok(maxSeen <= 1.6 + 1e-6, `最大速度 ${maxSeen.toFixed(3)} 超出上限 1.6`);
});

check("坐标没有变成 NaN", () => {
  const bodies = initBodies(makeItems(12, 45), W, H);
  for (let i = 0; i < 400; i++) step(bodies, W, H);
  for (const b of bodies) {
    assert.ok(Number.isFinite(b.x) && Number.isFinite(b.y), `出现 NaN: ${b.x},${b.y}`);
    assert.ok(Number.isFinite(b.vx) && Number.isFinite(b.vy), `速度出现 NaN`);
  }
});

console.log("\n=== 碰撞真的在起作用 ===");
check("两个正对的圆会互相弹开（不会穿过去）", () => {
  const bodies = [
    { id: 1, x: 300, y: 300, vx: 3, vy: 0, r: 40, mass: 1600 },
    { id: 2, x: 460, y: 300, vx: -3, vy: 0, r: 40, mass: 1600 },
  ];
  // 先关掉随机扰动，让行为可预测
  const opts = { jitter: 0, friction: 1 };
  let collided = false;
  const before = bodies[0].x;
  for (let i = 0; i < 60; i++) {
    step(bodies, W, H, opts);
    if (findOverlaps(bodies).length > 0) collided = true;
  }
  assert.ok(collided === false, "解算后不应残留重叠");
  // 碰撞后第 1 个球应被推回（x 减小），并且不再向对方内部前进
  assert.ok(bodies[0].x < 460, "第一个球穿到对方右边了（穿透）");
  assert.ok(bodies[0].vx <= 0.001, `碰撞后第一个球仍在向 +x 前进: vx=${bodies[0].vx}`);
  assert.ok(before !== bodies[0].x, "第一个球完全没动");
});

check("重叠的两个圆会被分开", () => {
  const bodies = [
    { id: 1, x: 300, y: 300, vx: 0, vy: 0, r: 40, mass: 1600 },
    { id: 2, x: 310, y: 300, vx: 0, vy: 0, r: 40, mass: 1600 }, // 严重重叠
  ];
  assert.ok(isOverlapping(bodies[0], bodies[1]), "前置条件：应当重叠");
  step(bodies, W, H, { jitter: 0, friction: 1 });
  assert.ok(!isOverlapping(bodies[0], bodies[1]), "一步之后仍未分开");
});

check("完全重合也能被分开（不会除零崩溃）", () => {
  const bodies = [
    { id: 1, x: 300, y: 300, vx: 0, vy: 0, r: 40, mass: 1600 },
    { id: 2, x: 300, y: 300, vx: 0, vy: 0, r: 40, mass: 1600 },
  ];
  step(bodies, W, H, { jitter: 0, friction: 1 });
  assert.ok(Number.isFinite(bodies[0].x) && Number.isFinite(bodies[1].x), "出现 NaN");
  assert.ok(!isOverlapping(bodies[0], bodies[1]), "完全重合后没分开");
});

check("质量不同：小圆被撞动得更多", () => {
  const bodies = [
    { id: 1, x: 300, y: 300, vx: 2, vy: 0, r: 20, mass: 400 },   // 小
    { id: 2, x: 360, y: 300, vx: 0, vy: 0, r: 60, mass: 3600 },  // 大
  ];
  const opts = { jitter: 0, friction: 1 };
  const smallBefore = bodies[0].x;
  const bigBefore = bodies[1].x;
  for (let i = 0; i < 40; i++) step(bodies, W, H, opts);
  const smallMoved = Math.abs(bodies[0].x - smallBefore);
  const bigMoved = Math.abs(bodies[1].x - bigBefore);
  assert.ok(smallMoved > bigMoved, `小圆位移 ${smallMoved} 应大于大圆 ${bigMoved}`);
});

console.log("\n=== 边界 ===");
check("贴左墙的圆会被推回并反弹", () => {
  const bodies = [{ id: 1, x: 5, y: 300, vx: -5, vy: 0, r: 40, mass: 1600 }];
  step(bodies, W, H, { jitter: 0, friction: 1 });
  assert.ok(bodies[0].x >= 40 - 1e-9, `没被推回: x=${bodies[0].x}`);
  assert.ok(bodies[0].vx > 0, `没反弹: vx=${bodies[0].vx}`);
});

check("贴右墙同理", () => {
  const bodies = [{ id: 1, x: W - 5, y: 300, vx: 5, vy: 0, r: 40, mass: 1600 }];
  step(bodies, W, H, { jitter: 0, friction: 1 });
  assert.ok(bodies[0].x <= W - 40 + 1e-9, `没被推回: x=${bodies[0].x}`);
  assert.ok(bodies[0].vx < 0, `没反弹: vx=${bodies[0].vx}`);
});

check("上下墙同理", () => {
  const t = [{ id: 1, x: 300, y: 2, vx: 0, vy: -5, r: 40, mass: 1600 }];
  step(t, W, H, { jitter: 0, friction: 1 });
  assert.ok(t[0].y >= 40 - 1e-9 && t[0].vy > 0, "上墙未反弹");
  const b = [{ id: 1, x: 300, y: H - 2, vx: 0, vy: 5, r: 40, mass: 1600 }];
  step(b, W, H, { jitter: 0, friction: 1 });
  assert.ok(b[0].y <= H - 40 + 1e-9 && b[0].vy < 0, "下墙未反弹");
});

check("容器比圆还小时不会死循环或 NaN", () => {
  const bodies = initBodies([{ id: 1, r: 200 }], 100, 100);
  for (let i = 0; i < 50; i++) step(bodies, 100, 100);
  assert.ok(Number.isFinite(bodies[0].x) && Number.isFinite(bodies[0].y));
});

console.log("\n=== 关闭碰撞时的对照 ===");
check("关掉碰撞后允许重叠（证明碰撞解算确实在做事）", () => {
  const bodies = [
    { id: 1, x: 300, y: 300, vx: 1, vy: 0, r: 40, mass: 1600 },
    { id: 2, x: 310, y: 300, vx: -1, vy: 0, r: 40, mass: 1600 },
  ];
  step(bodies, W, H, { jitter: 0, friction: 1 }, false);
  assert.ok(isOverlapping(bodies[0], bodies[1]), "关闭碰撞后反而分开了？");
});

console.log("\n=== 规模压力 ===");
check("40 个卡片跑 300 帧仍然正常", () => {
  const bodies = initBodies(makeItems(40, 36), W, H);
  for (let i = 0; i < 300; i++) step(bodies, W, H);
  assert.ok(allInside(bodies, W, H), "有圆出界");
  assert.equal(findOverlaps(bodies).length, 0, "有残留重叠");
});

console.log();
if (failures.length) {
  console.log(`[失败] ${failures.length} 项不通过（通过 ${pass} 项）：`);
  for (const f of failures) console.log("  -", f);
  process.exit(1);
}
console.log(`[通过] 物理模拟全部 ${pass} 项断言通过`);
