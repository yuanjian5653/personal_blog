/**
 * 友链卡片的 2D 物理：自由流动 + 相互碰撞。
 *
 * 抽成纯函数模块（不碰 DOM、不依赖 React），这样能被真正测试：
 * 物理最容易出的问题是"越界""叠在一起分不开""能量不守恒越跑越快"，
 * 这些用数值断言几分钟就能验证，靠肉眼看动画反而看不出来。
 *
 * 模型：
 * - 每个友链是一个圆（半径由权重决定）
 * - 圆之间有弹性碰撞（按半径当质量：大的更"沉"，被撞动得更少）
 * - 撞到边界反弹，并保留一点速度，避免贴边停住
 * - 每帧施加很小的随机扰动，让它们一直缓慢流动而不是最终静止
 */

export interface PhysicsBody {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  /** 质量（由半径换算，越大越沉） */
  mass: number;
}

export interface PhysicsOptions {
  /** 每帧速度保留比例（0.99 ≈ 很慢地衰减） */
  friction?: number;
  /** 随机扰动强度 */
  jitter?: number;
  /** 单帧最大速度（防止数值爆炸） */
  maxSpeed?: number;
}

const DEFAULTS: Required<PhysicsOptions> = {
  friction: 0.995,
  jitter: 0.035,
  maxSpeed: 1.6,
};

/** 用 id 生成稳定伪随机（避免 Math.random 导致每次刷新位置乱跳） */
function seeded(id: number, salt: number): number {
  const x = Math.sin(id * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * 初始化一批物理体，随机分布在场内且**保证不重叠**。
 *
 * 做法：把场地切成"每格边长 ≥ 2r"的网格，每格放一个圆，
 * 再在格内做小幅抖动。抖动幅度限制在 (格边长 - 2r)/2 以内，
 * 所以抖动后仍不会越入邻格 —— 从数学上保证初始不重叠。
 *
 * 之前用纯随机/固定网格列数，圆较大时会一开局就重叠，
 * 需要很多帧才分开，看起来像抽搐（测试里也抓到了这个）。
 */
export function initBodies(
  items: { id: number; r: number }[],
  width: number,
  height: number
): PhysicsBody[] {
  const bodies: PhysicsBody[] = [];
  const n = items.length;
  if (n === 0) return bodies;

  const maxR = Math.max(...items.map((it) => it.r));

  // 网格列数：先按格子装得下算，再按需扩行
  let cols = Math.max(1, Math.floor(width / (maxR * 2)));
  let rows = Math.ceil(n / cols);
  // 行数不够（场地太矮）就反过来压列数
  if (rows > Math.floor(height / (maxR * 2)) || rows === 0) {
    rows = Math.max(1, Math.floor(height / (maxR * 2)));
    cols = Math.ceil(n / rows);
  }

  // 格子实际边长：可能大于 2r（场地有余量），这样抖动空间更自然
  const cellW = width / cols;
  const cellH = height / rows;

  items.forEach((it, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols) % rows;

    // 抖动上限：保证抖动后圆仍完全落在自己格内
    const jx = (seeded(it.id, 1) - 0.5) * Math.max(0, cellW - it.r * 2) * 0.9;
    const jy = (seeded(it.id, 2) - 0.5) * Math.max(0, cellH - it.r * 2) * 0.9;

    // 格中心 + 抖动，并按圆半径夹进格子内部
    const cx = clamp(
      (col + 0.5) * cellW + jx,
      col * cellW + it.r,
      (col + 1) * cellW - it.r
    );
    const cy = clamp(
      (row + 0.5) * cellH + jy,
      row * cellH + it.r,
      (row + 1) * cellH - it.r
    );

    // 初始速度方向随机，速度很小 —— 只是"开始流动"
    const ang = seeded(it.id, 3) * Math.PI * 2;
    const sp = 0.15 + seeded(it.id, 4) * 0.25;

    bodies.push({
      id: it.id,
      x: cx,
      y: cy,
      vx: Math.cos(ang) * sp,
      vy: Math.sin(ang) * sp,
      r: it.r,
      mass: it.r * it.r, // 面积当质量
    });
  });

  return bodies;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** 圆心距离是否小于半径和（即是否重叠） */
export function isOverlapping(a: PhysicsBody, b: PhysicsBody, eps = 0.5): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const minD = a.r + b.r;
  return dx * dx + dy * dy < (minD - eps) * (minD - eps);
}

/**
 * 推进一帧（原地修改 bodies）。
 *
 * @param allowCollision 关掉时只做边界与漂移（供测试对比用）
 */
export function step(
  bodies: PhysicsBody[],
  width: number,
  height: number,
  options: PhysicsOptions = {},
  allowCollision = true
): void {
  const { friction, jitter, maxSpeed } = { ...DEFAULTS, ...options };
  const n = bodies.length;

  // ---- 1. 随机扰动 + 摩擦 ----
  for (const b of bodies) {
    b.vx += (Math.random() - 0.5) * jitter;
    b.vy += (Math.random() - 0.5) * jitter;
    b.vx *= friction;
    b.vy *= friction;

    // 限速（防止碰撞解算把速度放大到失控）
    const sp = Math.hypot(b.vx, b.vy);
    if (sp > maxSpeed) {
      b.vx = (b.vx / sp) * maxSpeed;
      b.vy = (b.vy / sp) * maxSpeed;
    }

    b.x += b.vx;
    b.y += b.vy;
  }

  // ---- 2. 边界反弹 ----
  for (const b of bodies) {
    if (b.x - b.r < 0) {
      b.x = b.r;
      b.vx = Math.abs(b.vx);
    } else if (b.x + b.r > width) {
      b.x = width - b.r;
      b.vx = -Math.abs(b.vx);
    }
    if (b.y - b.r < 0) {
      b.y = b.r;
      b.vy = Math.abs(b.vy);
    } else if (b.y + b.r > height) {
      b.y = height - b.r;
      b.vy = -Math.abs(b.vy);
    }
  }

  if (!allowCollision || n < 2) return;

  // ---- 3. 圆-圆碰撞 ----
  for (let i = 0; i < n; i++) {
    const a = bodies[i];
    for (let j = i + 1; j < n; j++) {
      const b = bodies[j];

      let dx = b.x - a.x;
      let dy = b.y - a.y;
      const dist2 = dx * dx + dy * dy;
      const minD = a.r + b.r;

      if (dist2 >= minD * minD) continue;

      let dist = Math.sqrt(dist2);
      if (dist === 0) {
        // 完全重合：给一个固定方向推开，避免除零
        dx = 0.01;
        dy = 0.01;
        dist = Math.hypot(dx, dy);
      }

      // 法线（单位向量，从 a 指向 b）
      const nx = dx / dist;
      const ny = dy / dist;

      // ---- 位置修正：各按质量反比推开，彻底消除重叠 ----
      const overlap = minD - dist;
      const total = a.mass + b.mass;
      const aPush = (b.mass / total) * overlap;
      const bPush = (a.mass / total) * overlap;
      a.x -= nx * aPush;
      a.y -= ny * aPush;
      b.x += nx * bPush;
      b.y += ny * bPush;

      // ---- 速度交换（一维弹性碰撞，沿法线方向）----
      const rvx = b.vx - a.vx;
      const rvy = b.vy - a.vy;
      const velAlongNormal = rvx * nx + rvy * ny;

      // 已经在分离就不再处理（否则会把它们吸回来）
      if (velAlongNormal > 0) continue;

      const e = 0.9; // 弹性系数
      const impulse = (-(1 + e) * velAlongNormal) / (1 / a.mass + 1 / b.mass);

      a.vx -= (impulse * nx) / a.mass;
      a.vy -= (impulse * ny) / a.mass;
      b.vx += (impulse * nx) / b.mass;
      b.vy += (impulse * ny) / b.mass;
    }
  }

  // 位置修正可能把圆推出边界，再夹一次
  for (const b of bodies) {
    b.x = clamp(b.x, b.r, Math.max(b.r, width - b.r));
    b.y = clamp(b.y, b.r, Math.max(b.r, height - b.r));
  }
}

/**
 * 找出所有重叠的对（测试用）。
 */
export function findOverlaps(bodies: PhysicsBody[], eps = 0.5): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      if (isOverlapping(bodies[i], bodies[j], eps)) {
        out.push([bodies[i].id, bodies[j].id]);
      }
    }
  }
  return out;
}

/** 是否所有圆都在场地内 */
export function allInside(
  bodies: PhysicsBody[],
  width: number,
  height: number,
  eps = 0.5
): boolean {
  return bodies.every(
    (b) =>
      b.x - b.r >= -eps &&
      b.y - b.r >= -eps &&
      b.x + b.r <= width + eps &&
      b.y + b.r <= height + eps
  );
}
