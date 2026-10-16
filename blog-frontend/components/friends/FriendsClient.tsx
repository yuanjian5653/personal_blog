"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  fetchFriendLinks,
  scaleToDiameter,
  seededRandom,
  weightToScale,
  type FriendLink,
} from "@/lib/friendlinks";
import { initBodies, step, type PhysicsBody } from "@/lib/physics";
import FriendCard from "@/components/friends/FriendCard";

/** 流星飞入耗时（毫秒） */
const FLY_IN_MS = 900;
/** 飞入时从多远处飞来（相对容器宽度的倍数） */
const FLY_DISTANCE = 1.15;

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
  /** 开始时间 */
  start: number;
  /** 每张卡片错开出场，营造"一颗接一颗划过"的感觉 */
  delay: number;
  duration: number;
}

export default function FriendsClient() {
  const [links, setLinks] = useState<FriendLink[] | null>(null);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  /** 每张卡片的 DOM 节点，动画循环直接改 transform（不走 React，避免每帧重渲染） */
  const nodesRef = useRef<Map<number, HTMLDivElement>>(new Map());
  const bodiesRef = useRef<PhysicsBody[]>([]);
  const flightsRef = useRef<Map<number, FlightState>>(new Map());
  const rafRef = useRef<number | null>(null);
  const sizeRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });
  /** 悬停/展开时暂停流动，方便点开气泡阅读 */
  const pausedRef = useRef(false);

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

  /** 尊重"减少动效"偏好：这类用户不应该被满屏乱飞的东西打扰 */
  const [reducedMotion, setReducedMotion] = useState(false);
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

    const vs = visualsRef.current;
    bodiesRef.current = initBodies(
      vs.map((v) => ({ id: v.id, r: v.size / 2 })),
      w,
      h
    );

    const now = performance.now();
    flightsRef.current.clear();
    bodiesRef.current.forEach((b, i) => {
      // 从容器外某处斜向飞来；角度用 id 做种子，保证每次刷新一致
      const ang = seededRandom(b.id, 7) * Math.PI * 2 - Math.PI;
      const dist = Math.max(w, h) * FLY_DISTANCE * (0.7 + seededRandom(b.id, 8) * 0.6);
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
  const paint = useCallback((now: number) => {
    const bodies = bodiesRef.current;
    const flights = flightsRef.current;

    for (const b of bodies) {
      const node = nodesRef.current.get(b.id);
      if (!node) continue;

      const f = flights.get(b.id);
      let dx = 0;
      let dy = 0;
      let trail = 0;
      let flying = false;

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
        // 拖尾强度：飞行中最强，落位后淡出
        trail = flying ? Math.max(0, 1 - t * 1.15) : 0;
      }

      // 位移用 transform，交给合成器，避免触发布局
      node.style.transform = `translate3d(${b.x - b.r + dx}px, ${
        b.y - b.r + dy
      }px, 0)`;

      // 拖尾：沿速度方向拉伸一层渐变
      const speed = Math.hypot(b.vx, b.vy);
      const ang = (Math.atan2(b.vy, b.vx) * 180) / Math.PI;
      const len = flying ? 90 + trail * 160 : Math.min(60, speed * 900);
      node.style.setProperty("--fc-trail-angle", `${ang}deg`);
      node.style.setProperty("--fc-trail-len", `${len}px`);
      node.style.setProperty("--fc-trail-alpha", String(flying ? 0.55 : 0.18));
      // 用 class 标记"正在飞入"，供 CSS 加外层光晕
      node.classList.toggle("is-flying", flying);
    }
  }, []);

  /** 主循环：只有不在"暂停"状态时才推进物理。
   *  用 ref 持有循环函数：requestAnimationFrame 需要自己安排下一帧，
   *  直接在 useCallback 里引用自身会被 lint 判定为"访问未声明的变量"，
   *  而且那样每次依赖变化都会换成一个新函数、旧的那帧仍在跑。
   *  放进 ref 后循环只启动一次，也便于卸载时取消。 */
  const loopRef = useRef<(now: number) => void>(() => {});

  useEffect(() => {
    loopRef.current = (now: number) => {
      const { w, h } = sizeRef.current;
      // 有卡片还在飞入时不推进物理 —— 否则"落点"一直移动，落位看起来在抖
      const flying = flightsRef.current.size > 0;
      if (!pausedRef.current && !flying && w > 0 && h > 0) {
        step(bodiesRef.current, w, h);
      }
      paint(now);
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
              : `${links.length} 位朋友 · 点一下卡片看详情`}
        </p>
      </div>

      {error && <p className="friends-error">加载失败：{error}</p>}

      {/* 舞台：卡片在这里自由流动 */}
      <div
        ref={containerRef}
        className={`friends-stage${reducedMotion ? " is-static" : ""}`}
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
                onToggle={() =>
                  setActiveId((prev) => (prev === link.id ? null : link.id))
                }
              />
            </div>
          );
        })}

        {/* 点空白处收起气泡 */}
        {activeLink && (
          <button
            type="button"
            className="friends-backdrop"
            aria-label="收起详情"
            onClick={() => setActiveId(null)}
          />
        )}
      </div>
    </div>
  );
}
