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
  /**
   * 是否正被鼠标拖动。
   * 拖动中的圆不参与积分（位置由指针直接给定），
   * 但仍然作为碰撞体把别的圆推开 —— 这样"拖着撞开一片"才成立。
   */
  dragging?: boolean;
}

export interface PhysicsOptions {
  /** 水平速度每帧保留比例（模拟滚动摩擦） */
  friction?: number;
  /** 随机扰动强度（静止下来靠它保持安静，所以设成 0） */
  jitter?: number;
  /** 单帧最大速度（防止数值爆炸/穿墙） */
  maxSpeed?: number;
  /**
   * 速度低于这个值就认为"快要停了"，直接归零。
   * 没有它的话，微小的残余速度会让球永远缓慢地爬来爬去。
   */
  sleepSpeed?: number;
  /** 重力加速度（每帧加到 vy 上） */
  gravity?: number;
  /** 落地反弹速度阈值：低于它就直接停住，不弹 */
  bounceThreshold?: number;
  /** 落地弹性系数 */
  restitution?: number;
}

const DEFAULTS: Required<PhysicsOptions> = {
  // 水平阻尼：模拟玻璃球在瓶底滚动的摩擦。
  // 竖直方向不乘它 —— 否则下落会被摩擦拖成"慢慢往下蹭"。
  friction: 0.9,
  jitter: 0,
  /*
   * 最大速度（终端速度）。必须**明显大于** sleepSpeed，否则有个坑：
   * 自由下落时速度会被夹到这个上限，而如果上限又低于 sleepSpeed，
   * 球会在下落途中被判为"已经停了"并直接归零 —— 表现就是悬在半空不动。
   */
  maxSpeed: 14,
  /*
   * 静止阈值。要略大于"密集堆叠时解算产生的残余抖动"，
   * 否则一堆球挤在一起时每帧都被推开一点点（实测残余速度约 0.3），
   * 永远低于阈值不了 —— 表现就是整堆一直在极轻微地蠕动。
   * 0.6 相当于每帧 0.6px，肉眼看不出，但足以让整堆真正定住。
   */
  sleepSpeed: 0.6,
  // 重力：0.45/帧² 大约 0.6 秒落 300px，比较像真球
  gravity: 0.45,
  // 落地速度超过这个值才弹（高速落地会"咚"一下，慢速就静止）
  bounceThreshold: 1.5,
  restitution: 0.45,
};

/** 供测试使用：查看实际生效的物理参数 */
export function resolveOptions(options: PhysicsOptions = {}): Required<PhysicsOptions> {
  return { ...DEFAULTS, ...options };
}

/**
 * 是否已经全部静止（都睡着了）。
 * 用来在停下之后**不再推进物理** —— 既省 CPU，
 * 也避免残余扰动让球永远抖动。
 */
export function isSettled(bodies: PhysicsBody[]): boolean {
  return bodies.every((b) => b.vx === 0 && b.vy === 0);
}

/** 用 id 生成稳定伪随机（避免 Math.random 导致每次刷新位置乱跳） */
function seeded(id: number, salt: number): number {
  const x = Math.sin(id * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * 初始化一批物理体：**全部排在容器上方**，等调用方按时间依次放开，
 * 它们就会一个接一个落下来。
 *
 * 模拟"玻璃球落进瓶子"：初始位置在容器上边缘之外、水平方向叉开，
 * 依次落下、互相碰撞、最后在底部堆叠静止。
 *
 * 关键点：
 * - 初始位置必须在容器**外部**（y 为负），否则会一生成就和别人的
 *   目标位置重叠 —— 之前那个版本正是这么做的，所以一开始就"炸开"。
 * - 只需要宽度：竖直方向是排成一列，与容器高度无关
 *  （所以这里没有 height 参数 —— 之前有，但用不到，属于无声的死参数）。
 */
export function initBodies(
  items: { id: number; r: number }[],
  width: number
): PhysicsBody[] {
  const bodies: PhysicsBody[] = [];
  const n = items.length;
  if (n === 0) return bodies;

  // 水平方向按"瓶子内壁"均匀铺开，再加一点抖动避免完全对齐
  const margin = Math.max(...items.map((it) => it.r));
  const usable = Math.max(1, width - margin * 2);

  items.forEach((it, i) => {
    const t = n === 1 ? 0.5 : i / (n - 1);
    const jitterX = (seeded(it.id, 1) - 0.5) * (usable / Math.max(1, n)) * 0.6;
    const x = clamp(margin + t * usable + jitterX, it.r, Math.max(it.r, width - it.r));

    // 起始高度：容器上方排成一列，间距 = 直径，落下来时自然一个接一个
    const gap = it.r * 2;
    const y = -it.r - i * gap;

    bodies.push({
      id: it.id,
      x,
      // 注意 y 可能为负：这是容器外，物理的边界处理会允许它先落进来
      y,
      // 给一点初速度让它立刻开始下落，避免第一帧静止
      vx: (seeded(it.id, 3) - 0.5) * 0.3,
      vy: 0.4 + seeded(it.id, 4) * 0.3,
      r: it.r,
      mass: it.r * it.r, // 面积当质量
    });
  });

  return bodies;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * 一遍圆-圆碰撞解算（位置修正 + 速度交换 + 叠放滚落）。
 *
 * 抽成独立函数是为了能跑多遍：密集堆叠时一遍会留下微小重叠，
 * 多跑一遍能把重叠清掉（物理引擎里叫 solver iteration）。
 */
function resolveCollisions(bodies: PhysicsBody[], width: number): void {
  const n = bodies.length;

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
      // 被鼠标拖住的圆位置由指针决定，不能被推开 ——
      // 所以把它当成"质量无穷大"：重叠全部由对方让出。
      const overlap = minD - dist;
      const aFixed = a.dragging === true;
      const bFixed = b.dragging === true;

      if (aFixed && bFixed) {
        // 两个都在被拖（多点触控）：各让一半，避免僵住
        a.x -= nx * overlap * 0.5;
        a.y -= ny * overlap * 0.5;
        b.x += nx * overlap * 0.5;
        b.y += ny * overlap * 0.5;
      } else if (aFixed) {
        b.x += nx * overlap;
        b.y += ny * overlap;
      } else if (bFixed) {
        a.x -= nx * overlap;
        a.y -= ny * overlap;
      } else {
        const total = a.mass + b.mass;
        a.x -= nx * ((b.mass / total) * overlap);
        a.y -= ny * ((b.mass / total) * overlap);
        b.x += nx * ((a.mass / total) * overlap);
        b.y += ny * ((a.mass / total) * overlap);
      }

      // ---- 速度交换（一维弹性碰撞，沿法线方向）----
      const rvx = b.vx - a.vx;
      const rvy = b.vy - a.vy;
      const velAlongNormal = rvx * nx + rvy * ny;

      // 已经在分离就不再处理（否则会把它们吸回来）
      if (velAlongNormal > 0) continue;

      const e = 0.9; // 弹性系数
      // 无穷大质量 => 1/mass = 0（拖动中的圆速度不被改变，只把动量传给对方）
      const invA = aFixed ? 0 : 1 / a.mass;
      const invB = bFixed ? 0 : 1 / b.mass;
      if (invA + invB === 0) continue;

      const impulse = (-(1 + e) * velAlongNormal) / (invA + invB);

      if (!aFixed) {
        a.vx -= impulse * nx * invA;
        a.vy -= impulse * ny * invA;
      }
      if (!bFixed) {
        b.vx += impulse * nx * invB;
        b.vy += impulse * ny * invB;
      }

      // ---- 切向微推：让叠在一起的球"滚下来" ----
      // 圆是各向同性的，法线接近竖直时噪声为零，上面的球会永远停在下面那个球上，
      // 看起来像叠罗汉而不是"落进瓶子的玻璃球"。真实球体会滑动滚落，
      // 这里沿切向加一点点速度来模拟。
      //
      // 但**只有"正在下落撞击"时才加**：两个球都已经很慢（稳住的堆叠）时再推
      // 会形成死循环 —— 每帧都被推一下，速度永远降不到 sleepSpeed 以下，
      // 整堆永远静不下来（实测 24 个球时 13 个永远在动，最大速度恒定在 0.59）。
      const isStacked = Math.abs(nx) < 0.25; // 法线几乎竖直 => 上下叠着
      const impact = Math.abs(velAlongNormal); // 撞击强度
      if (isStacked && !aFixed && !bFixed && impact > 0.8) {
        // 方向取"离容器中线更远"的那一侧，保证滚向瓶壁而不是原地抖
        const mid = width / 2;
        const dir = b.x >= mid ? 1 : -1;
        // 推力按撞击强度给，避免小碰撞被放大
        const tangent = Math.min(0.3, impact * 0.12);
        a.vx -= dir * tangent;
        b.vx += dir * tangent;
      }
    }
  }

  // 位置修正可能把圆推到墙上，这里顺手夹回来（不夹顶面）
  for (const b of bodies) {
    if (b.dragging) continue;
    b.x = clamp(b.x, b.r, Math.max(b.r, width - b.r));
  }
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
  const {
    friction,
    jitter,
    maxSpeed,
    sleepSpeed,
    gravity,
    bounceThreshold,
    restitution,
  } = { ...DEFAULTS, ...options };
  const n = bodies.length;

  // ---- 1. 重力 + 阻尼 + 位移 ----
  // 被拖动的圆跳过这一步：它的位置由鼠标给定，速度由松手时赋值
  for (const b of bodies) {
    if (b.dragging) continue;

    if (jitter > 0) {
      b.vx += (Math.random() - 0.5) * jitter;
      b.vy += (Math.random() - 0.5) * jitter;
    }

    b.vy += gravity;
    // 只对水平方向施加摩擦：竖直方向若也乘摩擦，
    // 下落会被拖成"慢慢往下蹭"，完全不像球掉下来
    b.vx *= friction;

    // 限速（终端速度）：防止长距离下落时单帧位移过大而穿过别的球
    const sp = Math.hypot(b.vx, b.vy);
    if (sp > maxSpeed) {
      b.vx = (b.vx / sp) * maxSpeed;
      b.vy = (b.vy / sp) * maxSpeed;
    }

    b.x += b.vx;
    b.y += b.vy;
  }

  // ---- 2. 边界 ----
  // 拖动中的圆不处理：位置完全由指针决定，
  // 否则走到边缘会被"吸"回界内，从指针下溜走。
  //
  // **没有顶面**：球是从容器上方排好队落下来的，顶面对它们来说不该存在。
  // 之前这里有个"单向顶面"（只在 y >= r 时拦），但那样整条上方队列
  // 都算"已进入容器"—— 先落下的球反弹回升后会被顶面再弹回去，
  // 形成永久上下弹跳，永远静不下来（实测单个球就是这样）。
  for (const b of bodies) {
    if (b.dragging) continue;

    if (b.x - b.r < 0) {
      b.x = b.r;
      b.vx = Math.abs(b.vx);
    } else if (b.x + b.r > width) {
      b.x = width - b.r;
      b.vx = -Math.abs(b.vx);
    }

    // 底面：硬地。
    // 慢速接触（被重力一直压着）就直接停住 —— 否则每帧弹一次，
    // 速度永远在 sleepSpeed 之上，球永远静不下来。
    if (b.y + b.r > height) {
      b.y = height - b.r;
      if (b.vy > 0) {
        b.vy = b.vy > bounceThreshold ? -b.vy * restitution : 0;
      }
    }
  }

  // ---- 3. 圆-圆碰撞 ----
  // 跑两遍：密集堆叠时单遍位置修正会留下微小重叠，
  // 第二遍把它清掉（物理引擎的常见做法，叫 solver iteration）。
  // 不这么做的话球会带着重叠一起"睡着"，堆里能看到互相嵌进去。
  //
  // 注意：这里**不能提前 return**。之前写成
  //     if (!allowCollision || n < 2) return;
  // 结果单个球（n < 2）会跳过最后的位置收尾和"静止归零"，
  // 于是永远静不下来（vx 衰减到 1e-94 也不算静止）。
  if (allowCollision && n >= 2) {
    for (let iter = 0; iter < 2; iter++) {
      resolveCollisions(bodies, width);
    }
  }

  // ---- 4. 收尾：限速 + 位置夹紧 + 静止归零 ----
  for (const b of bodies) {
    if (b.dragging) continue;
    b.x = clamp(b.x, b.r, Math.max(b.r, width - b.r));
    if (b.y + b.r > height) {
      b.y = height - b.r;
      // 压在地面上：清掉竖直速度，否则重力每帧累积的 0.45 会让
      // hypot 一直大于 sleepSpeed，球永远睡不下去
      if (b.vy > 0) b.vy = 0;
    }
    // 限速放在最后，保证调用方观察到的速度不超过 maxSpeed
    const sp = Math.hypot(b.vx, b.vy);
    if (sp > maxSpeed) {
      b.vx = (b.vx / sp) * maxSpeed;
      b.vy = (b.vy / sp) * maxSpeed;
    }
  }

  // ---- 5. 静止归零 ----
  // 关键：**必须"有支撑"才允许睡**。
  // 只按速度判断会在半空睡着 —— 球落地弹起、升到最高点时速度降到接近 0，
  // 一旦归零就再也不会被重力拉下来，永远停在半空（实测停在 y=519）。
  // 支撑 = 贴着底面，或与另一个球接触。
  for (const b of bodies) {
    if (b.dragging) continue;
    if (Math.hypot(b.vx, b.vy) >= sleepSpeed) continue;
    // 速度已经很小，确认它是不是被托住了
    const onFloor = b.y + b.r >= height - 1;
    if (onFloor) {
      b.vx = 0;
      b.vy = 0;
      continue;
    }
    // 不在底面：只要和另一个"已经停住"的球接触，就算被托住。
    // 加这个限制是为了避免一堆球在缓慢蠕动时互相把对方"支撑"住 ——
    // 那样谁都不算静止，整堆永远静不下来。
    const onSettled = bodies.some(
      (o) =>
        o !== b &&
        o.vx === 0 &&
        o.vy === 0 &&
        Math.hypot(o.x - b.x, o.y - b.y) <= o.r + b.r + 1.5
    );
    if (onSettled) {
      b.vx = 0;
      b.vy = 0;
    }
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
