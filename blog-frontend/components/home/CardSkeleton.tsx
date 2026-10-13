"use client";

/**
 * 卡片骨架屏：数据加载时占位。
 *
 * 高度策略：**填满外层容器**，而不是自己定一个固定高度。
 * 之前写死 min-height:140px，但真实卡片普遍更高
 * （.tracker-wrap 是 min-height:220px，个人卡片也更矮不了），
 * 于是加载完成时高度会跳一下。
 * 现在由调用方决定外层容器尺寸，骨架自动撑满，避免布局位移。
 */
export default function CardSkeleton({
  className = "",
  lines = 2,
}: {
  className?: string;
  lines?: number;
}) {
  return (
    <div
      className={`glass p-6 relative overflow-hidden h-full ${className}`}
    >
      <div className="skeleton-shimmer" />
      <div className="space-y-3">
        <div
          className="rounded-lg bg-white/5"
          style={{ height: 20, width: "55%" }}
        />
        {Array.from({ length: lines }).map((_, i) => (
          <div
            key={i}
            className="rounded bg-white/5"
            style={{ height: 12, width: `${70 - i * 15}%` }}
          />
        ))}
      </div>
    </div>
  );
}
