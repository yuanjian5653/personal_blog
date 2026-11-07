"use client";

import { useMounted } from "@/lib/useMounted";
import StarField from "./StarField";
import type { EggEffect } from "@/lib/easterEggs";

/**
 * 动态背景层（暗号解锁）。
 *
 * 三种情况：
 *   1. 后台上传了壁纸（kind=background 且有 asset_path）→ 视频 / 动图铺满
 *   2. 是内置星空（kind=stars）→ 用 StarField
 *   3. kind=background 但还没上传壁纸 → **回退到内置星空**
 *      这样"后台还没配好"的时候前台不会是一片空白
 *
 * 过渡动效（transition 由后台决定）：
 *   fade  淡入
 *   zoom  从放大 1.15 缩放进入
 *   slide 从下方推上来
 *   blur  从模糊到清晰
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

  const transition = TRANSITION_CLASS[egg.transition] ?? "is-fade";

  // 没上传壁纸 → 回退到内置星空
  if (!egg.asset_path) {
    return (
      <div className={`bg-layer ${transition}`} aria-hidden="true">
        <StarField />
      </div>
    );
  }

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
        <img className="bg-layer__media" src={egg.asset_path} alt="" />
      )}
      {/* 压一层暗，保证文字始终读得清 */}
      <span className="bg-layer__scrim" />
    </div>
  );
}
