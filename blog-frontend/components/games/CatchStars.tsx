"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { MorphIcon } from "morphicons/react";
import { ArrowLeft, ArrowRight } from "lucide";

/**
 * 接星星（暗号「游戏」解锁）
 *
 * 三个阶段：
 *   start    开始界面 —— 规则 + 最高分 + 「开始游戏」
 *   playing  进行中
 *   over     结束 —— 本局得分 + 「再来一局」/「回开始界面」
 *
 * 操作两套并存：
 *   · 键盘：← → 或 A / D 移动；空格 / 回车开始；Esc 关闭
 *   · 触摸：拖动画面移动；**另外给两个常驻按钮**（粗指针设备才显示）
 *     手机上单靠拖动不好控制，按钮可以长按连续移动
 *
 * 为什么循环里不 setState：
 *   requestAnimationFrame 每帧 setState 会让整棵树重渲染。
 *   只在"分数 / 生命 / 阶段"变化时同步到 React，其余时间纯 canvas 绘制。
 */

const BEST_KEY = "blog:catch-stars-best";
const BEST_EVENT = "blog:catch-stars-best-change";

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

/* ---------------- 难度曲线 ----------------
 *
 * 第一版是"按分数加难度"：接得越多越快越密。
 * 问题是分数涨得比时间快得多（一颗金星 +5），几秒就变地狱难度。
 *
 * 现在改成**按坚持时间**分级：
 *   · 起始很宽松（约 1 秒一颗，4~5 秒落到篮子上）
 *   · 每 15 秒升一级，最高 8 级
 *   · 密度和下落速度都按等级线性变化，不会在某一级突然变脸
 * ------------------------------------------ */
const LEVEL_SECONDS = 15;
const MAX_LEVEL = 8;
/** 生成间隔（按 60fps 的帧数算）：越大越稀 */
const SPAWN_FRAMES_START = 58;
const SPAWN_FRAMES_MIN = 24;
/** 下落速度（px/帧） */
const SPEED_START = 1.15;
const SPEED_PER_LEVEL = 0.2;

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

type Phase = "start" | "playing" | "over";

interface Props {
  onClose: () => void;
}

export default function CatchStars({ onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number>(0);
  // 长按方向：-1 左 / 1 右 / 0 停
  const holdRef = useRef<0 | -1 | 1>(0);
  // 与 level state 同步的 ref，避免把 level 放进循环依赖导致重复建循环
  const levelRef = useRef(0);

  const stateRef = useRef({
    stars: [] as Star[],
    basketX: 0,
    score: 0,
    lives: LIVES,
    spawnTimer: 0,
    lastTs: 0,
    running: false,
    /** 已坚持的秒数，难度按它算 */
    elapsed: 0,
  });

  const [phase, setPhase] = useState<Phase>("start");
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(LIVES);
  // 只用于显示；循环里发现等级变化时才 setState（不是每帧）
  const [level, setLevel] = useState(0);

  const best = useSyncExternalStore(subscribeBest, readBest, () => 0);

  /* ---------------- 开局 ---------------- */

  const startGame = useCallback(() => {
    const s = stateRef.current;
    s.stars = [];
    s.score = 0;
    s.lives = LIVES;
    s.spawnTimer = 0;
    s.lastTs = 0;
    s.elapsed = 0;
    s.running = true;
    levelRef.current = 0;
    s.basketX = (canvasRef.current?.clientWidth ?? 320) / 2;
    setScore(0);
    setLives(LIVES);
    setLevel(0);
    setPhase("playing");
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

    const drawStar = (s: Star) => {
      const r = s.gold ? GOLD_R : STAR_R;
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(s.rot);
      ctx.beginPath();
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

      const w = canvas.clientWidth;
      const h = canvas.clientHeight;

      // 未开始时只清屏（保持一块干净的深色画布）
      if (!s.running) {
        ctx.clearRect(0, 0, w, h);
        return;
      }

      const dt = Math.min((ts - (s.lastTs || ts)) / 16.67, 3); // 归一到 60fps 的"帧"
      s.lastTs = ts;

      // 先累计坚持时间，再按它算本周期的难度
      s.elapsed += dt / 60;
      const currentLevel = Math.min(
        MAX_LEVEL,
        Math.floor(s.elapsed / LEVEL_SECONDS)
      );
      if (currentLevel !== levelRef.current) {
        levelRef.current = currentLevel;
        setLevel(currentLevel); // 只有升级这一帧会 setState
      }

      ctx.clearRect(0, 0, w, h);

      // 长按屏幕按钮的连续移动
      if (holdRef.current !== 0) {
        s.basketX = Math.min(
          Math.max(s.basketX + holdRef.current * 7 * dt, BASKET_W / 2),
          w - BASKET_W / 2
        );
      }

      // 生成星星：分数越高越密
      const spawnFrames = Math.max(
        SPAWN_FRAMES_MIN,
        SPAWN_FRAMES_START - currentLevel * 4
      );
      const fallSpeed = SPEED_START + currentLevel * SPEED_PER_LEVEL;

      s.spawnTimer -= dt;
      if (s.spawnTimer <= 0) {
        s.spawnTimer = spawnFrames;
        const gold = Math.random() < 0.14;
        s.stars.push({
          x: STAR_R + Math.random() * (w - STAR_R * 2),
          y: -20,
          // 金星稍微慢一点，给玩家一点反应余量
          vy: (fallSpeed + Math.random() * 0.45) * (gold ? 0.9 : 1),
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
              s.running = false;
              if (s.score > readBest()) writeBest(s.score);
              setPhase("over");
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
  }, []);

  /* ---------------- 输入：键盘 ---------------- */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = stateRef.current;
      const canvas = canvasRef.current;
      const w = canvas?.clientWidth ?? 320;

      if (e.key === "Escape") {
        onClose();
        return;
      }

      // 开始 / 结束阶段：空格或回车开局
      if (!s.running && (e.key === " " || e.key === "Enter")) {
        e.preventDefault();
        startGame();
        return;
      }
      if (!s.running) return;

      const step = 30;
      if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") {
        s.basketX = Math.max(BASKET_W / 2, s.basketX - step);
        e.preventDefault();
      } else if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") {
        s.basketX = Math.min(w - BASKET_W / 2, s.basketX + step);
        e.preventDefault();
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, startGame]);

  /* ---------------- 输入：拖动画面 ---------------- */

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const moveTo = (clientX: number) => {
      const rect = canvas.getBoundingClientRect();
      const half = BASKET_W / 2;
      stateRef.current.basketX = Math.min(
        Math.max(clientX - rect.left, half),
        rect.width - half
      );
    };

    const onPointer = (e: PointerEvent) => {
      if (!stateRef.current.running) return;
      e.preventDefault();
      moveTo(e.clientX);
    };

    canvas.addEventListener("pointerdown", onPointer);
    canvas.addEventListener("pointermove", onPointer);
    return () => {
      canvas.removeEventListener("pointerdown", onPointer);
      canvas.removeEventListener("pointermove", onPointer);
    };
  }, []);

  /* ---------------- 输入：屏幕按钮（长按连续移动） ---------------- */

  const startHold = (dir: -1 | 1) => {
    holdRef.current = dir;
  };
  const endHold = () => {
    holdRef.current = 0;
  };

  // 组件卸载时确保不残留按住状态
  useEffect(() => {
    return () => {
      holdRef.current = 0;
    };
  }, []);

  return (
    <div className="cs-overlay" role="dialog" aria-modal="true" aria-label="接星星">
      <div className="cs-panel">
        <header className="cs-head">
          <div className="cs-title">
            ✦ 接星星
            <span className="cs-sub">接住掉下来的星星，别让它们落地</span>
          </div>
          <button
            type="button"
            className="cs-close"
            onClick={onClose}
            aria-label="关闭游戏"
          >
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
              <span className="cs-stat--empty">
                {"♡".repeat(Math.max(0, LIVES - lives))}
              </span>
            </b>
          </span>
          <span className="cs-stat">
            难度 <b>{level + 1}</b>
          </span>
          <span className="cs-stat cs-stat--best">
            最高 <b>{best}</b>
          </span>
        </div>

        <div className="cs-canvas-wrap">
          <canvas ref={canvasRef} className="cs-canvas" />

          {/* 开始界面 */}
          {phase === "start" && (
            <div className="cs-over cs-over--start">
              <p className="cs-over__title">接星星</p>
              <ul className="cs-rules">
                <li>
                  <b>白星</b> +1 分 · <b>金星</b> +5 分
                </li>
                <li>漏掉一颗扣一颗心，共 3 颗心</li>
                <li>每坚持 15 秒难度升一级，撑得越久越难</li>
              </ul>
              <p className="cs-keys">
                <span className="cs-key">←</span>
                <span className="cs-key">→</span>
                <span className="cs-keys__text">或 A / D 移动</span>
              </p>
              <button type="button" className="cs-again" onClick={startGame}>
                开始游戏
              </button>
              <p className="cs-hint-mini">空格 / 回车也可以开始</p>
            </div>
          )}

          {/* 结束界面 */}
          {phase === "over" && (
            <div className="cs-over">
              <p className="cs-over__title">星星掉光了</p>
              <p className="cs-over__score">
                这局 <b>{score}</b> 分
                {score > 0 && score >= best ? (
                  <span className="cs-over__new">新纪录！</span>
                ) : null}
              </p>
              <div className="cs-over__actions">
                <button type="button" className="cs-again" onClick={startGame}>
                  再来一局
                </button>
                <button
                  type="button"
                  className="cs-back"
                  onClick={() => setPhase("start")}
                >
                  回开始界面
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 移动端专用：长按连续移动（粗指针设备才显示） */}
        {phase === "playing" && (
          <div className="cs-touch">
            <button
              type="button"
              className="cs-touch__btn"
              aria-label="向左"
              onPointerDown={() => startHold(-1)}
              onPointerUp={endHold}
              onPointerCancel={endHold}
              onPointerLeave={endHold}
            >
              <MorphIcon icon={ArrowLeft} size={20} />
            </button>
            <button
              type="button"
              className="cs-touch__btn"
              aria-label="向右"
              onPointerDown={() => startHold(1)}
              onPointerUp={endHold}
              onPointerCancel={endHold}
              onPointerLeave={endHold}
            >
              <MorphIcon icon={ArrowRight} size={20} />
            </button>
          </div>
        )}

        <p className="cs-foot">Esc 关闭 · 拖动画布也能移动</p>
      </div>
    </div>
  );
}
