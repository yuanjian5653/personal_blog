/**
 * 友链卡片物理的测试（纯函数，无需浏览器）。
 *
 * 现在模拟的是"玻璃球落进瓶子"：全部从上方落下、碰撞、最后静止。
 * 这类物理最容易出的问题：
 *   1. 越界（球跑出容器或卡在边缘外）
 *   2. 永远不静止（残余速度让球一直微微抖动）
 *   3. 穿墙（下落速度过快时穿过底面）
 *   4. 叠罗汉（上面的球停在下面的球上，不滚下来）
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
  isSettled,
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

/** 一直推进到静止（或超时），返回用掉的帧数 */
function runUntilSettled(bodies, maxFrames = 4000) {
  for (let i = 0; i < maxFrames; i++) {
    step(bodies, W, H);
    if (isSettled(bodies)) return i + 1;
  }
  return -1;
}

console.log("=== 初始化：全部在容器上方 ===");
check("空列表返回空数组", () => {
  assert.deepEqual(initBodies([], W), []);
});

check("数量正确", () => {
  assert.equal(initBodies(makeItems(8), W).length, 8);
});

check("初始位置都在容器**上方**（模拟从上面落下）", () => {
  const bodies = initBodies(makeItems(6, 40), W);
  for (const b of bodies) {
    assert.ok(b.y < 0, `球 ${b.id} 初始 y=${b.y}，应该在容器外(上方)`);
  }
});

check("水平方向叉开、不重叠（否则一生成就炸开）", () => {
  const bodies = initBodies(makeItems(8, 40), W);
  // 只看水平：竖直方向错开了，所以用 x 间距判断
  const xs = bodies.map((b) => b.x).sort((a, b) => a - b);
  for (let i = 1; i < xs.length; i++) {
    assert.ok(
      xs[i] - xs[i - 1] >= 2 * 40 - 1,
      `相邻球水平间距过小: ${xs[i] - xs[i - 1]}`
    );
  }
});

check("初始水平位置都在容器内（不考虑半径溢出）", () => {
  const bodies = initBodies(makeItems(10, 40), W);
  for (const b of bodies) {
    assert.ok(b.x - b.r >= -1 && b.x + b.r <= W + 1, `球 ${b.id} x=${b.x} 超出水平范围`);
  }
});

check("竖直方向依次错开（形成下落队列）", () => {
  const bodies = initBodies(makeItems(6, 40), W);
  const ys = bodies.map((b) => b.y);
  for (let i = 1; i < ys.length; i++) {
    assert.ok(ys[i] < ys[i - 1], `第 ${i} 个球没在前一个上方: ${ys[i]} vs ${ys[i - 1]}`);
  }
});

check("给了一点向下初速度，不会卡在第一帧", () => {
  const bodies = initBodies(makeItems(4, 40), W);
  for (const b of bodies) {
    assert.ok(b.vy > 0, `球 ${b.id} 没有向下初速度`);
  }
});

console.log("\n=== 落下之后：全部静止、不出界、不重叠 ===");
check("8 个球能在合理帧数内全部静止", () => {
  const bodies = initBodies(makeItems(8, 40), W);
  const frames = runUntilSettled(bodies);
  assert.ok(frames > 0, "一直没静止（超过 4000 帧）");
  console.log(`         用了 ${frames} 帧静止`);
});

check("静止后全部在容器内", () => {
  const bodies = initBodies(makeItems(8, 40), W);
  runUntilSettled(bodies);
  assert.ok(allInside(bodies, W, H), "有球停在容器外");
});

check("静止后没有重叠", () => {
  const bodies = initBodies(makeItems(8, 40), W);
  runUntilSettled(bodies);
  const overlaps = findOverlaps(bodies);
  assert.equal(overlaps.length, 0, `残留 ${overlaps.length} 对重叠`);
});

check("静止后速度确实都是 0（不再有微小抖动）", () => {
  const bodies = initBodies(makeItems(8, 40), W);
  runUntilSettled(bodies);
  for (const b of bodies) {
    assert.equal(b.vx, 0, `球 ${b.id} vx=${b.vx}`);
    assert.equal(b.vy, 0, `球 ${b.id} vy=${b.vy}`);
  }
});

check("静止后再推进也不会自己动起来（允许亚像素级微调）", () => {
  const bodies = initBodies(makeItems(6, 40), W);
  runUntilSettled(bodies);
  const snapshot = bodies.map((b) => [b.x, b.y]);
  for (let i = 0; i < 120; i++) step(bodies, W, H);
  bodies.forEach((b, i) => {
    const dx = Math.abs(b.x - snapshot[i][0]);
    const dy = Math.abs(b.y - snapshot[i][1]);
    // 阈值 1px：静止判定本身允许每帧 0.6px 的残余速度，
    // 完全"一位不动"不现实；但 120 帧移动超过 1px 就说明没真正停住。
    assert.ok(dx < 1, `球 ${b.id} 又横向移动了 ${dx.toFixed(3)}px`);
    assert.ok(dy < 1, `球 ${b.id} 又纵向移动了 ${dy.toFixed(3)}px`);
  });
});

check("球都沉到底部附近（真的落下来了，没有悬在半空）", () => {
  const bodies = initBodies(makeItems(8, 40), W);
  runUntilSettled(bodies);
  // 至少有一个球贴着底面，且没有球停在上半部
  const touchingFloor = bodies.filter((b) => b.y + b.r >= H - 1.5).length;
  assert.ok(touchingFloor >= 1, `没有球落地: ${bodies.map((b) => b.y.toFixed(0))}`);
  for (const b of bodies) {
    assert.ok(b.y > H * 0.4, `球 ${b.id} 停在 y=${b.y.toFixed(0)}，太高了（没落下来）`);
  }
});

check("大规模（24 个）也能全部静止", () => {
  const bodies = initBodies(makeItems(24, 34), W);
  const frames = runUntilSettled(bodies, 8000);
  assert.ok(frames > 0, "24 个球没能静止");
  assert.ok(allInside(bodies, W, H), "有球出界");
  assert.equal(findOverlaps(bodies).length, 0, "有残留重叠");
  console.log(`         用了 ${frames} 帧静止`);
});

console.log("\n=== 不下穿底面 / 不越界 ===");
check("极快下落不会穿过底面", () => {
  const bodies = [
    { id: 1, x: 300, y: H / 2, vx: 0, vy: 60, r: 40, mass: 1600 },
  ];
  for (let i = 0; i < 120; i++) step(bodies, W, H);
  assert.ok(allInside(bodies, W, H), `穿墙了: y=${bodies[0].y}`);
});

check("坐标始终没有 NaN", () => {
  const bodies = initBodies(makeItems(10, 40), W);
  for (let i = 0; i < 800; i++) step(bodies, W, H);
  for (const b of bodies) {
    assert.ok(Number.isFinite(b.x) && Number.isFinite(b.y), `NaN: ${b.x},${b.y}`);
  }
});

check("下落后速度不会发散", () => {
  const bodies = initBodies(makeItems(12, 40), W);
  let maxSeen = 0;
  for (let i = 0; i < 600; i++) {
    step(bodies, W, H);
    for (const b of bodies) maxSeen = Math.max(maxSeen, Math.hypot(b.vx, b.vy));
  }
  // 上限由物理在收尾时夹紧，允许极小的浮点误差
  assert.ok(maxSeen <= 14 + 1e-6, `最大速度 ${maxSeen.toFixed(6)} 超出上限 14`);
});

console.log("\n=== 碰撞仍然生效 ===");
check("两个正对的圆会互相弹开（不穿透）", () => {
  const bodies = [
    { id: 1, x: 300, y: 300, vx: 3, vy: 0, r: 40, mass: 1600 },
    { id: 2, x: 460, y: 300, vx: -3, vy: 0, r: 40, mass: 1600 },
  ];
  for (let i = 0; i < 60; i++) step(bodies, W, H);
  assert.ok(bodies[0].x < 460, "第一个球穿到对方右边了");
  assert.ok(findOverlaps(bodies).length === 0, "解算后残留重叠");
});

check("重叠的两个圆会被分开", () => {
  const bodies = [
    { id: 1, x: 300, y: 300, vx: 0, vy: 0, r: 40, mass: 1600 },
    { id: 2, x: 310, y: 300, vx: 0, vy: 0, r: 40, mass: 1600 },
  ];
  step(bodies, W, H);
  assert.ok(!isOverlapping(bodies[0], bodies[1]), "一步之后仍未分开");
});

check("完全重合也能分开（不除零崩溃）", () => {
  const bodies = [
    { id: 1, x: 300, y: 300, vx: 0, vy: 0, r: 40, mass: 1600 },
    { id: 2, x: 300, y: 300, vx: 0, vy: 0, r: 40, mass: 1600 },
  ];
  step(bodies, W, H);
  assert.ok(Number.isFinite(bodies[0].x) && Number.isFinite(bodies[1].x), "出现 NaN");
  assert.ok(!isOverlapping(bodies[0], bodies[1]), "完全重合后没分开");
});

check("上面叠的球会滚下来（不会永远叠罗汉）", () => {
  // 正上下叠放，法线竖直
  const bodies = [
    { id: 1, x: 500, y: 560, vx: 0, vy: 0, r: 40, mass: 1600 },
    { id: 2, x: 500, y: 480, vx: 0, vy: 2, r: 40, mass: 1600 },
  ];
  for (let i = 0; i < 400; i++) step(bodies, W, H);
  assert.ok(allInside(bodies, W, H), "有球出界");
  // 关键：两个球最终不应还是"正上下叠着"
  const sameX = Math.abs(bodies[0].x - bodies[1].x) < 2;
  const stackedY = Math.abs(bodies[0].y - bodies[1].y) < 2 * 40 - 2;
  assert.ok(!(sameX && stackedY), "球一直叠在上面没滚下来");
});

console.log("\n=== 拖拽（dragging 标记）===");
check("拖动中的圆不会被阻尼/边界改变位置", () => {
  const bodies = [
    { id: 1, x: 300, y: 300, vx: 5, vy: 5, r: 40, mass: 1600, dragging: true },
  ];
  for (let i = 0; i < 60; i++) step(bodies, W, H);
  assert.equal(bodies[0].x, 300, "拖动中的圆被物理移动了");
  assert.equal(bodies[0].y, 300, "拖动中的圆被物理移动了");
});

check("拖动中的圆能把别的圆推开（碰撞仍生效）", () => {
  const bodies = [
    { id: 1, x: 300, y: 300, vx: 0, vy: 0, r: 40, mass: 1600, dragging: true },
    { id: 2, x: 330, y: 300, vx: 0, vy: 0, r: 40, mass: 1600 },
  ];
  assert.ok(isOverlapping(bodies[0], bodies[1]), "前置条件：应当重叠");
  step(bodies, W, H);
  assert.ok(!isOverlapping(bodies[0], bodies[1]), "拖动中的圆没能推开对方");
  assert.equal(bodies[0].x, 300, "被拖动的圆自己动了（应由对方让位）");
  assert.ok(bodies[1].x > 330, `对方没被推开: x=${bodies[1].x}`);
});

check("松手后恢复参与物理", () => {
  const bodies = [
    { id: 1, x: 300, y: 300, vx: 1.2, vy: 0, r: 40, mass: 1600, dragging: true },
  ];
  step(bodies, W, H);
  assert.equal(bodies[0].x, 300, "拖动中不该动");
  bodies[0].dragging = false;
  for (let i = 0; i < 10; i++) step(bodies, W, H);
  assert.ok(bodies[0].x > 300, "松手后没有继续运动");
});

check("两个都被拖时不会互相僵住", () => {
  const bodies = [
    { id: 1, x: 300, y: 300, vx: 0, vy: 0, r: 40, mass: 1600, dragging: true },
    { id: 2, x: 310, y: 300, vx: 0, vy: 0, r: 40, mass: 1600, dragging: true },
  ];
  step(bodies, W, H);
  assert.ok(!isOverlapping(bodies[0], bodies[1]), "两个都被拖时没分开");
  assert.ok(Number.isFinite(bodies[0].x) && Number.isFinite(bodies[1].x), "出现 NaN");
});

check("拖到角落里，其它圆仍不会出界", () => {
  const bodies = initBodies(makeItems(8, 36), W);
  runUntilSettled(bodies);
  bodies[0].dragging = true;
  bodies[0].x = 40;
  bodies[0].y = 40;
  for (let i = 0; i < 200; i++) step(bodies, W, H);
  const others = bodies.slice(1);
  assert.ok(allInside(others, W, H), "有非拖动的圆出界了");
  assert.equal(bodies[0].x, 40, "被拖的圆移动了");
});

console.log("\n=== 容器异常尺寸 ===");
check("容器比圆还小时不会死循环或 NaN", () => {
  const bodies = initBodies([{ id: 1, r: 200 }], 100, 100);
  for (let i = 0; i < 50; i++) step(bodies, 100, 100);
  assert.ok(Number.isFinite(bodies[0].x) && Number.isFinite(bodies[0].y));
});

check("单个球也能落到底并静止", () => {
  const bodies = initBodies([{ id: 1, r: 40 }], W);
  const frames = runUntilSettled(bodies);
  assert.ok(frames > 0, "单球也没静止");
  assert.ok(bodies[0].y + 40 >= H - 1.5, `没落到地面: y=${bodies[0].y}`);
});

console.log();
if (failures.length) {
  console.log(`[失败] ${failures.length} 项不通过（通过 ${pass} 项）：`);
  for (const f of failures) console.log("  -", f);
  process.exit(1);
}
console.log(`[通过] 物理模拟全部 ${pass} 项断言通过`);
