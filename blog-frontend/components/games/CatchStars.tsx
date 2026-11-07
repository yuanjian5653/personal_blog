"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

/**
 * 接星星（暗号「游戏」解锁）
 *
 * 玩法：底下一个篮子左右移动接住掉落的星星。
 *   · 白星 +1 分
 *   · 金星 +5 分（偶尔出现）
 *   · 漏掉一颗扣 1 条命，3 条命用光结束
 *   · 越高分落得越快（难度自动上涨）
 *
 * 为什么用 canvas 而不是 DOM 元素：
 *   同时最多十几颗星，DOM 也能做，但 canvas 只用一次重绘，
 *   而且不用为了性能给每个星星加 will-change。页面里还有音乐播放器，省一点是一点。
 *
 * 为什么把循环放在 ref 里而不是 React state：
 *   requestAnimationFrame 每帧都 setState 会让整棵组件树重渲染。
 *   只在"分数/生命变化"时才同步到 React 状态，其余时间纯 canvas 绘制。
 */

const BEST_KEY = "blog:catch-stars-best";
const BEST_EVENT = "blog:catch-stars-best-change";

/** 读最高分。注意：给 useSyncExternalStore 用的快照是**数字**，
 *  基本类型按值比较，所以不需要额外缓存引用。 */
function readBest(): number {
  if (typeof window === "undefined") return 0;
  try {
    return parseInt(window.localStorage.getItem(BEST_KEY) ?? "0", 10) || 0;
  } catch {
    return 0;
  }
}

function subscribeBest(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(BEST_EVENT, cb);
  return () => window.removeEventListener(BEST_EVENT, cb);
}

function writeBest(value: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(BEST_KEY, String(value));
  } catch {
    /* 隐私模式下写不进去就算了 */
  }
  window.dispatchEvent(new Event(BEST_EVENT));
}
const LIVES = 3;
const BASKET_W = 74;
const BASKET_H = 16;
const STAR_R = 7;
const GOLD_R = 9;

interface Star {
  x: number;
  y: number;
  vy: number;
  vx: number;
  gold: boolean;
  rot: number;
  vr: number;
}

interface Props {
  onClose: () => void;
}

export default function CatchStars({ onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number>(0);

  // 循环里用的可变状态（不触発渲染）
  const stateRef = useRef({
    stars: [] as Star[],
    basketX: 0,
    score: 0,
    lives: LIVES,
    spawnTimer: 0,
    lastTs: 0,
    running: false,
    over: false,
  });

  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(LIVES);
  const [over, setOver] = useState(false);


  // 最高分：localStorage 是外部数据源，用 useSyncExternalStore 读，
  // 避免"在 effect 里同步 setState"（会多一轮渲染，也被项目 lint 拦）。
  const best = useSyncExternalStore(subscribeBest, readBest, () => 0);

  const reset = useCallback(() => {
    const s = stateRef.current;
    s.stars = [];
    s.score = 0;
    s.lives = LIVES;
    s.spawnTimer = 0;
    s.over = false;
    s.running = true;
    s.basketX = (canvasRef.current?.clientWidth ?? 320) / 2;
    setScore(0);
    setLives(LIVES);
    setOver(false);
  }, []);

  /* ---------------- 主循环 ---------------- */

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // 尺寸自适应（含设备像素比，避免糊）
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (!stateRef.current.basketX) stateRef.current.basketX = w / 2;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    reset();

    const drawStar = (s: Star) => {
      const r = s.gold ? GOLD_R : STAR_R;
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(s.rot);
      ctx.beginPath();
      // 五角星
      for (let i = 0; i < 5; i += 1) {
        const outer = (Math.PI / 2) * -1 + (i * Math.PI * 2) / 5;
        const inner = outer + Math.PI / 5;
        ctx.lineTo(Math.cos(outer) * r, Math.sin(outer) * r);
        ctx.lineTo(Math.cos(inner) * r * 0.45, Math.sin(inner) * r * 0.45);
      }
      ctx.closePath();
      ctx.fillStyle = s.gold ? "#ffd76a" : "#e8eefc";
      ctx.shadowColor = s.gold ? "#ffd76a" : "#bcd2ff";
      ctx.shadowBlur = s.gold ? 14 : 8;
      ctx.fill();
      ctx.restore();
    };

    const tick = (ts: number) => {
      const s = stateRef.current;
      rafRef.current = requestAnimationFrame(tick);
      if (!s.running) return;

      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const dt = Math.min((ts - (s.lastTs || ts)) / 16.67, 3); // 归一到 60fps 的"帧"
      s.lastTs = ts;

      // 画背景
      ctx.clearRect(0, 0, w, h);

      // 生成星星：分数越高越密
      s.spawnTimer -= dt;
      if (s.spawnTimer <= 0) {
        const density = Math.max(16, 42 - s.score * 0.6);
        s.spawnTimer = density;
        const gold = Math.random() < 0.14;
        s.stars.push({
          x: STAR_R + Math.random() * (w - STAR_R * 2),
          y: -20,
          vy: (1.6 + Math.random() * 1.2 + s.score * 0.02) * (gold ? 0.85 : 1),
          vx: (Math.random() - 0.5) * 0.7,
          gold,
          rot: Math.random() * Math.PI,
          vr: (Math.random() - 0.5) * 0.08,
        });
      }

      // 更新 & 碰撞
      const basketY = h - 26;
      for (let i = s.stars.length - 1; i >= 0; i -= 1) {
        const st = s.stars[i];
        st.y += st.vy * dt;
        st.x += st.vx * dt;
        st.rot += st.vr * dt;

        // 碰到底线
        if (st.y >= basketY - 6) {
          const inBasket =
            st.x > s.basketX - BASKET_W / 2 - 4 &&
            st.x < s.basketX + BASKET_W / 2 + 4;
          if (inBasket) {
            s.score += st.gold ? 5 : 1;
            setScore(s.score);
          } else {
            s.lives -= 1;
            setLives(s.lives);
            if (s.lives <= 0) {
              s.over = true;
              s.running = false;
              setOver(true);
              // 只在破纪录时写；写完靠事件通知 useSyncExternalStore 重读
              if (s.score > readBest()) writeBest(s.score);
            }
          }
          s.stars.splice(i, 1);
          continue;
        }
        drawStar(st);
      }

      // 篮子
      ctx.save();
      const bx = s.basketX - BASKET_W / 2;
      ctx.beginPath();
      ctx.roundRect(bx, basketY - BASKET_H, BASKET_W, BASKET_H, 8);
      ctx.fillStyle = "rgba(124, 92, 255, 0.85)";
      ctx.shadowColor = "#7c5cff";
      ctx.shadowBlur = 16;
      ctx.fill();
      // 篮口高光
      ctx.beginPath();
      ctx.roundRect(bx + 4, basketY - BASKET_H, BASKET_W - 8, 4, 2);
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.shadowBlur = 0;
      ctx.fill();
      ctx.restore();
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
    };
  }, [reset]);

  /* ---------------- 操作：鼠标 / 触摸 / 键盘 ---------------- */

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const moveTo = (clientX: number) => {
      const rect = canvas.getBoundingClientRect();
      const half = BASKET_W / 2;
      const x = clientX - rect.left;
      stateRef.current.basketX = Math.min(
        Math.max(x, half),
        rect.width - half
      );
    };

    const onPointer = (e: PointerEvent) => {
      e.preventDefault();
      moveTo(e.clientX);
    };
    const onKey = (e: KeyboardEvent) => {
      const s = stateRef.current;
      const w = canvas.clientWidth;
      const step = 28;
      if (e.key === "ArrowLeft" || e.key === "a") {
        s.basketX = Math.max(BASKET_W / 2, s.basketX - step);
        e.preventDefault();
      } else if (e.key === "ArrowRight" || e.key === "d") {
        s.basketX = Math.min(w - BASKET_W / 2, s.basketX + step);
        e.preventDefault();
      } else if (e.key === "Escape") {
        onClose();
      }
    };

    canvas.addEventListener("pointermove", onPointer);
    canvas.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      canvas.removeEventListener("pointermove", onPointer);
      canvas.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div className="cs-overlay" role="dialog" aria-modal="true" aria-label="接星星">
      <div className="cs-panel">
        <header className="cs-head">
          <div className="cs-title">
            ✦ 接星星
            <span className="cs-sub">移动鼠标 / 手指接住它们</span>
          </div>
          <button type="button" className="cs-close" onClick={onClose} aria-label="关闭游戏">
            ✕
          </button>
        </header>

        <div className="cs-stats">
          <span className="cs-stat">
            得分 <b>{score}</b>
          </span>
          <span className="cs-stat">
            生命{" "}
            <b>
              {"♥".repeat(Math.max(0, lives))}
              <span className="cs-stat--empty">{"♡".repeat(Math.max(0, LIVES - lives))}</span>
            </b>
          </span>
          <span className="cs-stat cs-stat--best">
            最高 <b>{best}</b>
          </span>
        </div>

        <div className="cs-canvas-wrap" ref={wrapRef}>
          <canvas ref={canvasRef} className="cs-canvas" />

          {over && (
            <div className="cs-over">
              <p className="cs-over__title">星星掉光了</p>
              <p className="cs-over__score">
                这局 <b>{score}</b> 分
                {score > 0 && score >= best ? (
                  <span className="cs-over__new">新纪录！</span>
                ) : null}
              </p>
              <button type="button" className="cs-again" onClick={reset}>
                再来一局
              </button>
            </div>
          )}
        </div>

        <p className="cs-foot">
          白星 +1 · 金星 +5 · 漏掉扣一颗心（Esc 关闭）
        </p>
      </div>
    </div>
  );
}
