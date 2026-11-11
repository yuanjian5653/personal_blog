"use client";

import { useMounted } from "@/lib/useMounted";
import type { EggEffect } from "@/lib/easterEggs";

/**
 * 动态背景层（暗号解锁）。
 *
 * 只做一件事：把后台上传的壁纸铺满背景，并压一层暗色 scrim。
 *
 * **没有壁纸时不渲染任何东西**（返回 null）。
 * 早先这里会回退到内置星空，后来那个星空效果被删掉了 ——
 * 与其给用户一个"解锁了但看不出变化"的困惑，不如什么都不做。
 * 后台列表里会明确显示「未上传壁纸」，提示你去传一个。
 *
 * 过渡动效（transition 由后台决定）：
 *   fade  淡入
 *   zoom  从放大 1.18 + 模糊推进来
 *   slide 从下方推上来
 *   blur  从模糊 24px 到清晰
 * 都带一点"点亮"的意思，而不是硬切。
 */
interface Props {
  egg: EggEffect;
}

const TRANSITION_CLASS: Record<string, string> = {
  fade: "is-fade",
  zoom: "is-zoom",
  slide: "is-slide",
  blur: "is-blur",
};

export default function BackgroundLayer({ egg }: Props) {
  const mounted = useMounted();
  if (!mounted) return null;

  // 没上传壁纸 → 不渲染（不再回退到星空）
  if (!egg.asset_path) return null;

  const transition = TRANSITION_CLASS[egg.transition] ?? "is-fade";

  return (
    <div className={`bg-layer ${transition}`} aria-hidden="true">
      {egg.asset_kind === "video" ? (
        <video
          className="bg-layer__media"
          src={egg.asset_path}
          autoPlay
          loop
          muted
          playsInline
          /* 壁纸只是氛围，不该抢带宽优先级 */
          preload="metadata"
        />
      ) : (
        <img decoding="async" className="bg-layer__media" src={egg.asset_path} alt="" />
      )}
      {/* 压一层暗，保证文字始终读得清 */}
      <span className="bg-layer__scrim" />
    </div>
  );
}
