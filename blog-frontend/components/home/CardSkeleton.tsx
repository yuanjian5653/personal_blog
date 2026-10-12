"use client";

/** 卡片骨架屏：用于数据加载时占位 */
export default function CardSkeleton({
  className = "",
  lines = 2,
}: {
  className?: string;
  lines?: number;
}) {
  return (
    <div
      className={`glass p-6 relative overflow-hidden ${className}`}
      style={{ minHeight: "140px" }}
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