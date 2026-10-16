"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  fetchFriendLinks,
  hostOf,
  initialOf,
  scaleToDiameter,
  weightToScale,
  type FriendLink,
} from "@/lib/friendlinks";
import { initBodies, isSettled, step, type PhysicsBody } from "@/lib/physics";
import FriendCard from "@/components/friends/FriendCard";

/**
 * 落下节奏：每张卡片错开一点时间依次落下，
 * 像往瓶子里一颗一颗放玻璃球，而不是一起倒进去。
 */
const DROP_STAGGER_MS = 140;
/** 指针移动多少像素才算"拖动"而不是"点击" */
const DRAG_THRESHOLD = 4;
/** 松手时的最大抛出速度（跟物理的 maxSpeed 对齐） */
const THROW_CAP = 12;

interface DragState {
  id: number;
  /** 指针与卡片中心的差值，避免按下瞬间卡片"跳"到指针位置 */
  offsetX: number;
  offsetY: number;
  startX: number;
  startY: number;
  moved: boolean;
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
  /**
   * 每张卡片的"允许下落时间"。到点之前把它按在容器上方不动 ——
   * 这样它们是一个接一个掉进来，而不是同时落下。
   */
  const releaseRef = useRef<Map<number, number>>(new Map());
  const dragRef = useRef<DragState | null>(null);
  const activeIdRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const sizeRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });
  /** 全部静止后就不再推进物理（省 CPU，也避免残余抖动） */
  const settledRef = useRef(false);

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

  /** 尊重"减少动效"偏好：这类用户不该被满屏乱动的东西打扰 */
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  /** 初始化物理体（都排在容器上方）与下落时间表 */
  const setup = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const w = el.clientWidth;
    const h = el.clientHeight;
    if (w === 0 || h === 0) return;

    sizeRef.current = { w, h };

    // reduced-motion：不做物理，交给 CSS 静态网格排布
    if (reducedMotion) {
      bodiesRef.current = [];
      releaseRef.current.clear();
      return;
    }

    const vs = visualsRef.current;
    bodiesRef.current = initBodies(
      vs.map((v) => ({ id: v.id, r: v.size / 2 })),
      w
    );

    // 依次释放：第一个立刻落，后面每个晚一点
    const now = performance.now();
    const release = new Map<number, number>();
    bodiesRef.current.forEach((b, i) => {
      release.set(b.id, now + i * DROP_STAGGER_MS);
    });
    releaseRef.current = release;
    settledRef.current = false;
  }, [reducedMotion]);

  /** 把物理状态写到 DOM */
  const paint = useCallback(() => {
    const bodies = bodiesRef.current;
    const drag = dragRef.current;

    for (const b of bodies) {
      const node = nodesRef.current.get(b.id);
      if (!node) continue;
      // 位移用 transform，交给合成器，避免触发布局
      node.style.transform = `translate3d(${b.x - b.r}px, ${b.y - b.r}px, 0)`;
      node.classList.toggle("is-dragging", drag?.id === b.id);
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
        bubble.style.transform = `translate3d(${b.x}px, ${b.y}px, 0)`;
        // 上方空间不够就翻到下面；左右贴边时把气泡往内推
        bubble.classList.toggle("is-below", b.y < b.r + 170);
        bubble.classList.toggle("is-near-left", b.x < 150);
        bubble.classList.toggle("is-near-right", b.x > w - 150);
        bubble.classList.toggle("is-near-bottom", b.y > h - 120);
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
    loopRef.current = (now: number) => {
      const { w, h } = sizeRef.current;
      const bodies = bodiesRef.current;

      if (w > 0 && h > 0 && bodies.length > 0) {
        // 还没到下落时间的卡片：按在容器上方不动
        const release = releaseRef.current;
        for (const b of bodies) {
          const at = release.get(b.id);
          if (at === undefined) continue;
          if (now < at) {
            b.vx = 0;
            b.vy = 0;
          } else {
            release.delete(b.id); // 到点了，交给物理
          }
        }

        // 全部静止后就不再推进（拖动时例外）
        if (!settledRef.current || dragRef.current !== null) {
          step(bodies, w, h);
          if (releaseRef.current.size === 0 && isSettled(bodies)) {
            settledRef.current = true;
          }
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
  // 拖拽：长按拖动卡片，可把别的卡片撞开
  // ---------------------------------------------------------------
  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;

    // 气泡内的点击（例如"访问站点"链接）不触发拖动
    const target = e.target as HTMLElement;
    if (target.closest(".fc-bubble")) return;

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

    // 抓住就把"已静止"解除，物理重新跑起来
    settledRef.current = false;

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
    // 指针捕获加在舞台上（而不是卡片上）：卡片位置在移动，
    // 捕在舞台上拖动更稳，也不会干扰气泡里的链接点击
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
      if (dist < DRAG_THRESHOLD) return; // 还没到阈值，保留点击语义
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

    // 直接给位置（拖动中的圆不参与积分，这里是唯一的位置来源）
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
      // 抛出：速度超过上限就夹到上限，避免松手后瞬移
      const sp = Math.hypot(drag.vx, drag.vy);
      if (sp > THROW_CAP) {
        body.vx = (drag.vx / sp) * THROW_CAP;
        body.vy = (drag.vy / sp) * THROW_CAP;
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

      {/* 舞台：卡片从上方落入、落定后静止；也可以被拖动 */}
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
            >
              <FriendCard link={link} visual={v} active={activeId === link.id} />
            </div>
          );
        })}

        {/* 气泡层：独立一层，避免被舞台的 overflow:hidden 和其它卡片裁掉/盖住 */}
        <div
          ref={bubbleRef}
          className={`fc-bubble-layer${activeId === null ? " is-hidden" : ""}`}
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
