"use client";

import { useMemo } from "react";

import { useMounted } from "@/lib/useMounted";

/**
 * 背景星空（暗号「星空」解锁）。
 *
 * 第一版做完太平了 —— 星星太小太暗，几乎看不出来。这一版的目标是
 * "打开暗号的那一下要有惊喜感"，所以做了这些：
 *
 * 1. **三层视差**：远/中/近三层，size、亮度、漂移幅度各不相同。
 *    单层星星看起来像噪点，三层叠起来才有纵深。
 * 2. **光的质感**：近层星星带 box-shadow 发光，不再是纯色小点。
 * 3. **星云**：两团极大的低透明度径向渐变缓慢漂移，
 *    给"空黑的背景"一点层次，星星才有地方"挂"。
 * 4. **流星更亮更长**：带发光头部 + 渐隐长尾，且间隔缩短。
 * 5. **入场动画**：解锁瞬间星星从 0 缩放淡入（错峰），
 *    而不是直接出现 —— 这是"惊喜感"最关键的一下。
 *
 * 性能：约 150 个元素，全部 CSS 动画（不占主线程）。
 * 页面里还跑着音乐播放器，所以发光只给近层用，控制重绘面积。
 */

/** 固定种子的伪随机，保证刷新后是同一片天 */
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

/** 星星颜色：大部分白，少量偏蓝、偏暖，夜空才不假 */
const TINTS = [
  "255, 255, 255",
  "255, 255, 255",
  "255, 255, 255",
  "207, 227, 255", // 冷蓝
  "255, 233, 196", // 暖金
];

interface Layer {
  id: string;
  count: number;
  /** 直径范围（px） */
  size: [number, number];
  /** 透明度范围 */
  opacity: [number, number];
  /** 闪烁一轮的时长范围（秒） */
  duration: [number, number];
  /** 水平漂移幅度（px） */
  drift: number;
  /** 是否发光 */
  glow: boolean;
}

const LAYERS: Layer[] = [
  { id: "far", count: 90, size: [0.9, 1.8], opacity: [0.35, 0.75], duration: [4.5, 9], drift: 8, glow: false },
  { id: "mid", count: 46, size: [1.4, 2.4], opacity: [0.5, 0.95], duration: [3, 6], drift: 16, glow: false },
  { id: "near", count: 20, size: [2, 3.4], opacity: [0.7, 1], duration: [2.2, 4.2], drift: 26, glow: true },
];

const SHOOTING_COUNT = 5;

export default function StarField() {
  const mounted = useMounted();

  const layers = useMemo(
    () =>
      LAYERS.map((layer, layerIndex) => {
        const rnd = mulberry32(20261107 + layerIndex * 977);
        return {
          ...layer,
          stars: Array.from({ length: layer.count }, (_, i) => ({
            key: `${layer.id}-${i}`,
            left: rnd() * 100,
            top: rnd() * 100,
            size: layer.size[0] + rnd() * (layer.size[1] - layer.size[0]),
            opacity:
              layer.opacity[0] + rnd() * (layer.opacity[1] - layer.opacity[0]),
            duration:
              layer.duration[0] +
              rnd() * (layer.duration[1] - layer.duration[0]),
            // 错峰：入场和闪烁都靠这个 delay 才自然
            delay: rnd() * 5,
            enterDelay: rnd() * 0.9,
            drift: (rnd() * 2 - 1) * layer.drift,
            tint: TINTS[Math.floor(rnd() * TINTS.length)],
          })),
        };
      }),
    []
  );

  const shooting = useMemo(() => {
    const rnd = mulberry32(4242);
    return Array.from({ length: SHOOTING_COUNT }, (_, i) => ({
      key: i,
      top: 2 + rnd() * 46,
      left: 5 + rnd() * 55,
      duration: 2.6 + rnd() * 2,
      // 第一颗来得早一点，让人"立刻"看到动静，之后按较长间隔再来
      delay: i === 0 ? 1.2 : 5 + i * 7 + rnd() * 5,
    }));
  }, []);

  if (!mounted) return null;

  return (
    <div className="starfield" aria-hidden="true">
      {/* 星云：不参与闪烁，只慢慢漂 */}
      <span className="starfield__nebula starfield__nebula--a" />
      <span className="starfield__nebula starfield__nebula--b" />

      {layers.map((layer) => (
        <div
          key={layer.id}
          className={`starfield__layer starfield__layer--${layer.id}`}
        >
          {layer.stars.map((s) => (
            <span
              key={s.key}
              className={`starfield__star${layer.glow ? " is-glow" : ""}`}
              style={{
                left: `${s.left}%`,
                top: `${s.top}%`,
                width: s.size,
                height: s.size,
                opacity: s.opacity,
                background: `rgb(${s.tint})`,
                color: `rgb(${s.tint})`,
                // 两个动画并发：入场 0.9s + 闪烁 s.duration 秒。
                // 时长和延迟都要按动画逐个给，否则两者会共用同一个值。
                animationDuration: `0.9s, ${s.duration}s`,
                animationDelay: `${s.enterDelay}s, ${s.delay}s`,
                ["--star-drift" as string]: `${s.drift}px`,
                ["--enter-delay" as string]: `${s.enterDelay}s`,
              }}
            />
          ))}
        </div>
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

      {/* 解锁瞬间的一下"点亮"，看过就没了 */}
      <span className="starfield__burst" />
    </div>
  );
}
