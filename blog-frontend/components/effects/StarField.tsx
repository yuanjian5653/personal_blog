"use client";

import { useMemo } from "react";

import { useMounted } from "@/lib/useMounted";

/**
 * 背景星空（暗号「星空」解锁）。
 *
 * 几个刻意的决定：
 *
 * 1. **纯 CSS 动画，不用 canvas / rAF**
 *    星星只是"缓慢闪烁 + 极慢漂移"，CSS keyframes 足够，
 *    而且不占主线程 —— 页面上还有个音乐播放器在跑。
 *
 * 2. **位置用固定种子的伪随机**
 *    刷新后星星位置不变（不会每次进站都换一片天），
 *    用 mulberry32 保证同一份布局。
 *
 * 3. **等挂载后才渲染**
 *    位置依赖 Math.random 类的行为，SSR 阶段渲染会和客户端不一致，
 *    所以用 useMounted 先渲染空，挂载后再出现（避免 hydration 报错）。
 *
 * 4. `z-index: -1`
 *    背景图是 body::before(-2)，压暗遮罩是 body::after(-1)。
 *    放在 -1 意味着它在页面内容之下、遮罩附近，
 *    不会挡住任何点击（pointer-events: none）。
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STAR_COUNT = 110;
const SHOOTING_COUNT = 3;

export default function StarField() {
  const mounted = useMounted();

  const stars = useMemo(() => {
    const rnd = mulberry32(20261107);
    return Array.from({ length: STAR_COUNT }, (_, i) => {
      const size = 0.8 + rnd() * 1.8;
      return {
        key: i,
        // 用百分比定位，窗口缩放也不会跑出屏幕
        left: rnd() * 100,
        top: rnd() * 100,
        size,
        // 越小的星星越暗、闪得越慢，看起来更像真实夜空
        opacity: 0.25 + rnd() * 0.6,
        duration: 2.4 + rnd() * 4.6,
        delay: rnd() * 6,
        drift: rnd() * 40 - 20,
      };
    });
  }, []);

  const shooting = useMemo(() => {
    const rnd = mulberry32(777);
    return Array.from({ length: SHOOTING_COUNT }, (_, i) => ({
      key: i,
      top: 5 + rnd() * 45,
      left: 10 + rnd() * 55,
      duration: 3.2 + rnd() * 2.4,
      // 每颗流星间隔很长，别一直刷屏
      delay: 4 + i * 11 + rnd() * 6,
    }));
  }, []);

  if (!mounted) return null;

  return (
    <div className="starfield" aria-hidden="true">
      {stars.map((s) => (
        <span
          key={s.key}
          className="starfield__star"
          style={{
            left: `${s.left}%`,
            top: `${s.top}%`,
            width: s.size,
            height: s.size,
            opacity: s.opacity,
            animationDuration: `${s.duration}s`,
            animationDelay: `${s.delay}s`,
            ["--star-drift" as string]: `${s.drift}px`,
          }}
        />
      ))}

      {shooting.map((s) => (
        <span
          key={s.key}
          className="starfield__shooting"
          style={{
            top: `${s.top}%`,
            left: `${s.left}%`,
            animationDuration: `${s.duration}s`,
            animationDelay: `${s.delay}s`,
          }}
        />
      ))}
    </div>
  );
}
