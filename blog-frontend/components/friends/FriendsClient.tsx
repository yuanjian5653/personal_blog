"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  fetchFriendLinks,
  hostOf,
  initialOf,
  scaleToDiameter,
  seededRandom,
  weightToScale,
  type FriendLink,
} from "@/lib/friendlinks";
import { initBodies, step, type PhysicsBody } from "@/lib/physics";
import FriendCard from "@/components/friends/FriendCard";

/** 流星飞入耗时（毫秒） */
const FLY_IN_MS = 900;
/** 飞入时从多远处飞来（相对容器尺寸的倍数） */
const FLY_DISTANCE = 1.15;
/** 拖拽时拖尾的强度上限 */
const DRAG_TRAIL_ALPHA = 0.5;
/** 指针移动多少像素才算"拖动"而不是"点击" */
const DRAG_THRESHOLD = 4;

/**
 * 流星飞入的缓动：先冲过头一点再回弹（back-out）。
 * 这是"回弹效果"的来源 —— 普通 ease-out 落位会很平。
 */
function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

interface FlightState {
  /** 起始偏移（相对最终位置） */
  dx: number;
  dy: number;
  start: number;
  /** 每张卡片错开出场，营造"一颗接一颗划过"的感觉 */
  delay: number;
  duration: number;
}

interface DragState {
  id: number;
  /** 指针与卡片中心的差值，避免按下瞬间卡片"跳"到指针位置 */
  offsetX: number;
  offsetY: number;
  /** 指针起点，用来区分点击与拖动 */
  startX: number;
  startY: number;
  moved: boolean;
  /** 最近一次移动的位置与时间，用于松手时计算抛出速度 */
  lastX: number;
  lastY: number;
  lastT: number;
  vx: number;
  vy: number;
}

export default function FriendsClient() {
  const [links, setLinks] = useState<FriendLink[] | null>(null);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reducedMotion, setReducedMotion] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  /** 气泡单独放一层：舞台是 overflow:hidden，气泡留在卡片里会被裁掉 */
  const bubbleRef = useRef<HTMLDivElement>(null);

  /** 每张卡片的 DOM 节点；动画循环直接改 transform（不走 React，避免每帧重渲染） */
  const nodesRef = useRef<Map<number, HTMLDivElement>>(new Map());
  const bodiesRef = useRef<PhysicsBody[]>([]);
  const flightsRef = useRef<Map<number, FlightState>>(new Map());
  const dragRef = useRef<DragState | null>(null);
  const activeIdRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const sizeRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });
  /** 指针停在卡片上时暂停流动，方便点开气泡阅读 */
  const pausedRef = useRef(false);

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  useEffect(() => {
    let cancelled = false;
    fetchFriendLinks()
      .then((list) => {
        if (!cancelled) setLinks(list);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "加载失败");
        setLinks([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** 权重 → 卡片尺寸。用列表内的 min/max 归一化，权重填多少都能合理分布 */
  const visuals = useMemo(() => {
    if (!links || links.length === 0) return [];
    const weights = links.map((l) => l.weight);
    const min = Math.min(...weights);
    const max = Math.max(...weights);
    return links.map((l) => {
      const t = weightToScale(l.weight, min, max);
      return { id: l.id, size: Math.round(scaleToDiameter(t)), emphasis: t };
    });
  }, [links]);

  const visualsRef = useRef(visuals);
  useEffect(() => {
    visualsRef.current = visuals;
  }, [visuals]);

  /** 尊重"减少动效"偏好：这类用户不该被满屏乱飞的东西打扰 */
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  /** 初始化物理体 + 流星起点 */
  const setup = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const w = el.clientWidth;
    const h = el.clientHeight;
    if (w === 0 || h === 0) return;

    sizeRef.current = { w, h };

    // reduced-motion：不做物理、不做飞入，交给 CSS 静态网格排布
    if (reducedMotion) {
      bodiesRef.current = [];
      flightsRef.current.clear();
      return;
    }

    // 保留正在拖动的状态（窗口尺寸变化时不该把拖拽打断）
    const draggingId = dragRef.current?.id ?? null;

    const vs = visualsRef.current;
    const bodies = initBodies(
      vs.map((v) => ({ id: v.id, r: v.size / 2 })),
      w,
      h
    );
    if (draggingId !== null) {
      const old = bodiesRef.current.find((b) => b.id === draggingId);
      const nr = bodies.find((b) => b.id === draggingId);
      if (old && nr) {
        nr.x = old.x;
        nr.y = old.y;
        nr.dragging = true;
      }
    }
    bodiesRef.current = bodies;

    const now = performance.now();
    flightsRef.current.clear();
    bodies.forEach((b, i) => {
      // 从容器外某处斜向飞来；角度与距离用 id 做种子，保证每次刷新一致
      const ang = seededRandom(b.id, 7) * Math.PI * 2 - Math.PI;
      const dist =
        Math.max(w, h) * FLY_DISTANCE * (0.7 + seededRandom(b.id, 8) * 0.6);
      flightsRef.current.set(b.id, {
        dx: Math.cos(ang) * dist,
        dy: Math.sin(ang) * dist,
        start: now,
        delay: i * 70 + seededRandom(b.id, 9) * 120,
        duration: FLY_IN_MS + seededRandom(b.id, 10) * 350,
      });
    });
  }, [reducedMotion]);

  /** 把物理状态写到 DOM */
  const paint = useCallback(() => {
    const bodies = bodiesRef.current;
    const flights = flightsRef.current;
    const drag = dragRef.current;
    const now = performance.now();

    for (const b of bodies) {
      const node = nodesRef.current.get(b.id);
      if (!node) continue;

      const f = flights.get(b.id);
      const dragging = drag?.id === b.id;
      let dx = 0;
      let dy = 0;
      let flying = false;
      let flyProgress = 0;

      if (f) {
        const t = (now - f.start - f.delay) / f.duration;
        if (t <= 0) {
          // 还没轮到它出场：藏在起点，完全透明
          node.style.opacity = "0";
          node.style.transform = `translate3d(${b.x - b.r + f.dx}px, ${
            b.y - b.r + f.dy
          }px, 0)`;
          continue;
        }
        if (t < 1) {
          flying = true;
          flyProgress = t;
          // 位置：从起点滑向目标，用回弹缓动
          const e = easeOutBack(t);
          dx = f.dx * (1 - e);
          dy = f.dy * (1 - e);
          // 透明度用更"直"的曲线，避免回弹段又变透明
          node.style.opacity = String(Math.min(1, easeOutCubic(t * 1.6)));
        } else {
          flights.delete(b.id);
          node.style.opacity = "1";
        }
      }

      // 位移用 transform，交给合成器，避免触发布局
      node.style.transform = `translate3d(${b.x - b.r + dx}px, ${
        b.y - b.r + dy
      }px, 0)`;

      // ---- 拖尾 ----
      // 只在「飞入」和「被手拖动」时出现。
      // 自由流动时**不画尾迹** —— 那是持续的缓慢漂移，一直拖着尾巴会显得很脏。
      const speed = Math.hypot(b.vx, b.vy);
      const ang = (Math.atan2(b.vy, b.vx) * 180) / Math.PI;
      let alpha = 0;
      let len = 0;

      if (flying) {
        alpha = 0.55 * Math.max(0, 1 - flyProgress * 1.15);
        len = 90 + (1 - flyProgress) * 160;
      } else if (dragging) {
        // 拖得越快，尾巴越长越亮
        alpha = DRAG_TRAIL_ALPHA * Math.min(1, 0.4 + speed * 0.55);
        len = 70 + Math.min(240, speed * 90);
      }

      node.style.setProperty("--fc-trail-angle", `${ang}deg`);
      node.style.setProperty("--fc-trail-len", `${len}px`);
      node.style.setProperty("--fc-trail-alpha", String(alpha));
      node.classList.toggle("is-flying", flying);
      node.classList.toggle("is-dragging", dragging);
    }

    // ---- 气泡跟随卡片 ----
    // 气泡在独立的层里（舞台 overflow:hidden 会裁掉卡片内的气泡），
    // 所以每帧按卡片位置重新摆放，并判断朝上还是朝下。
    const bubble = bubbleRef.current;
    const aid = activeIdRef.current;
    if (bubble && aid !== null) {
      const b = bodies.find((x) => x.id === aid);
      const node = nodesRef.current.get(aid);
      if (b && node) {
        const { w, h } = sizeRef.current;
        // 拖动中卡片位置已经写进 body，直接用它
        const cx = b.x;
        const cy = b.y;
        bubble.style.transform = `translate3d(${cx}px, ${cy}px, 0)`;
        // 上方空间不够就翻到下面；左右贴边时把气泡往内推
        bubble.classList.toggle("is-below", cy < b.r + 170);
        bubble.classList.toggle("is-near-left", cx < 150);
        bubble.classList.toggle("is-near-right", cx > w - 150);
        bubble.classList.toggle("is-near-bottom", cy > h - 120);
      }
    }
  }, []);

  /** 主循环。
   *  用 ref 持有循环函数：requestAnimationFrame 需要自己安排下一帧，
   *  直接在 useCallback 里引用自身会被 lint 判为"访问未声明的变量"，
   *  而且每次依赖变化都会换函数、旧的那帧仍在跑。
   *  放进 ref 后循环只启动一次，也便于卸载时取消。 */
  const loopRef = useRef<(now: number) => void>(() => {});

  useEffect(() => {
    loopRef.current = () => {
      const { w, h } = sizeRef.current;
      // 有卡片还在飞入时不推进物理 —— 否则"落点"一直移动，落位看起来在抖
      const flying = flightsRef.current.size > 0;
      if (!flying && w > 0 && h > 0) {
        // 拖动中也要跑 step：拖动的圆会把其它圆推开（碰撞），
        // 只是它自己不参与积分（见 physics.ts 里的 dragging 分支）
        if (dragRef.current !== null) {
          step(bodiesRef.current, w, h);
        } else if (!pausedRef.current) {
          step(bodiesRef.current, w, h);
        }
      }
      paint();
      rafRef.current = requestAnimationFrame((t) => loopRef.current(t));
    };
  }, [paint]);

  // 数据到位后初始化，并启动循环
  useEffect(() => {
    if (!links || links.length === 0) return;
    setup();
    rafRef.current = requestAnimationFrame((t) => loopRef.current(t));
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [links, setup]);

  // 尺寸变化：重新初始化，避免卡片被留在容器外
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const ro = new ResizeObserver(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setup(), 180);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, [setup]);

  // ---------------------------------------------------------------
  // 拖拽：长按拖动卡片，可把别的卡片撞开，拖动时有拖尾
  // ---------------------------------------------------------------
  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;

    // 找出指针下"最上层"的卡片：后画的在上面，所以从后往前找
    const bodies = bodiesRef.current;
    let hit: PhysicsBody | null = null;
    for (let i = bodies.length - 1; i >= 0; i--) {
      const b = bodies[i];
      if (Math.hypot(px - b.x, py - b.y) <= b.r) {
        hit = b;
        break;
      }
    }
    if (!hit) return;

    // 气泡内的点击（例如"访问站点"链接）不触发拖动
    const target = e.target as HTMLElement;
    if (target.closest(".fc-bubble")) return;

    dragRef.current = {
      id: hit.id,
      offsetX: px - hit.x,
      offsetY: py - hit.y,
      startX: px,
      startY: py,
      moved: false,
      lastX: px,
      lastY: py,
      lastT: performance.now(),
      vx: 0,
      vy: 0,
    };
    // 指针捕获加在舞台上（而不是卡片按钮上）：卡片的位置在移动，
    // 捕获在舞台上能让拖动更稳，也不会干扰气泡里的链接点击
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* 某些环境不支持，忽略即可 */
    }
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const el = containerRef.current;
    if (!drag || !el) return;
    const rect = el.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;

    if (!drag.moved) {
      const dist = Math.hypot(px - drag.startX, py - drag.startY);
      if (dist < DRAG_THRESHOLD) return; // 还没到阈值，不算拖动（保留点击语义）
      drag.moved = true;
      const body = bodiesRef.current.find((b) => b.id === drag.id);
      if (body) body.dragging = true;
    }

    const body = bodiesRef.current.find((b) => b.id === drag.id);
    if (!body) return;

    // 记录速度（像素/帧）供松手时抛出
    const now = performance.now();
    const dt = Math.max(1, now - drag.lastT);
    const instVx = ((px - drag.lastX) / dt) * 16.67;
    const instVy = ((py - drag.lastY) / dt) * 16.67;
    // 平滑一下，避免最后一帧的抖动决定抛出方向
    drag.vx = drag.vx * 0.6 + instVx * 0.4;
    drag.vy = drag.vy * 0.6 + instVy * 0.4;
    drag.lastX = px;
    drag.lastY = py;
    drag.lastT = now;

    // 直接给位置（拖动中的圆不参与积分，所以这里是唯一的位置来源）
    body.x = px - drag.offsetX;
    body.y = py - drag.offsetY;
    body.vx = drag.vx;
    body.vy = drag.vy;
  }, []);

  const endDrag = useCallback((e?: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const el = containerRef.current;
    if (!drag) return;
    dragRef.current = null;

    const body = bodiesRef.current.find((b) => b.id === drag.id);
    if (body) {
      body.dragging = false;
      // 抛出：速度上限跟物理的 maxSpeed 对齐，避免松手后瞬移
      const sp = Math.hypot(drag.vx, drag.vy);
      const cap = 1.6;
      if (sp > cap) {
        body.vx = (drag.vx / sp) * cap;
        body.vy = (drag.vy / sp) * cap;
      } else {
        body.vx = drag.vx;
        body.vy = drag.vy;
      }
    }

    if (el && e) {
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {
        /* 忽略 */
      }
    }

    // 位移很小 => 视为点击，切换气泡
    if (!drag.moved) {
      setActiveId((prev) => (prev === drag.id ? null : drag.id));
    }
  }, []);

  const activeLink = links?.find((l) => l.id === activeId) ?? null;

  return (
    <div className="friends-page">
      <div className="friends-hero">
        <h1 className="friends-hero__title">友链</h1>
        <p className="friends-hero__sub">
          {links === null
            ? "加载中…"
            : links.length === 0
              ? "还没有添加友链"
              : `${links.length} 位朋友 · 点一下看详情，长按可以拖动`}
        </p>
      </div>

      {error && <p className="friends-error">加载失败：{error}</p>}

      {/* 舞台：卡片在这里自由流动、也可被拖动 */}
      <div
        ref={containerRef}
        className={`friends-stage${reducedMotion ? " is-static" : ""}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {links?.length === 0 && !error && (
          <p className="friends-empty">博主还没有添加友链～</p>
        )}

        {links?.map((link) => {
          const v = visuals.find((x) => x.id === link.id);
          if (!v) return null;
          return (
            <div
              key={link.id}
              className="fc-slot"
              ref={(el) => {
                if (el) nodesRef.current.set(link.id, el);
                else nodesRef.current.delete(link.id);
              }}
              onPointerEnter={() => {
                pausedRef.current = true;
              }}
              onPointerLeave={() => {
                pausedRef.current = false;
              }}
            >
              <FriendCard
                link={link}
                visual={v}
                active={activeId === link.id}
              />
            </div>
          );
        })}

        {/* 气泡层：放在舞台里，但用 fixed 定位 + 高层级，
            避免被舞台的 overflow:hidden 以及其它卡片挡住 */}
        <div
          ref={bubbleRef}
          className={`fc-bubble-layer${
            activeId === null ? " is-hidden" : ""
          }`}
        >
          {activeLink && <FriendBubble link={activeLink} />}
        </div>
      </div>
    </div>
  );
}

/** 气泡详情（与卡片分离，由 fc-bubble-layer 负责定位） */
function FriendBubble({ link }: { link: FriendLink }) {
  const [coverBroken, setCoverBroken] = useState(false);
  const showCover = !!link.cover && !coverBroken;

  return (
    <div className="fc-bubble">
      <div className="fc-bubble__head">
        {showCover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={link.cover as string}
            alt=""
            className="fc-bubble__avatar"
            onError={() => setCoverBroken(true)}
            draggable={false}
          />
        ) : (
          <span className="fc-bubble__avatar fc-bubble__avatar--fallback">
            {initialOf(link.name)}
          </span>
        )}
        <div className="fc-bubble__title-wrap">
          <div className="fc-bubble__title">{link.name}</div>
          <div className="fc-bubble__host">{hostOf(link.url)}</div>
        </div>
      </div>
      {link.description && <p className="fc-bubble__desc">{link.description}</p>}
      <div className="fc-bubble__foot">
        {link.category && <span className="fc-bubble__tag">{link.category}</span>}
        <a
          className="fc-bubble__visit"
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          访问站点 →
        </a>
      </div>
      <div className="fc-bubble__arrow" />
    </div>
  );
}
