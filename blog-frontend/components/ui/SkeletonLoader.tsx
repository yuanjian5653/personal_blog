"use client";

/**
 * 骨架屏加载组件
 * 用法：
 *   <SkeletonLoader />                  标准四行
 *   <SkeletonLoader lines={2} />        自定义行数
 */
export default function SkeletonLoader({ lines = 2 }: { lines?: number }) {
  return (
    <div className="skeleton-loader">
      <div className="sk-wrapper">
        <div className="sk-circle" />
        <div className="sk-line-1" />
        <div className="sk-line-2" />
        {lines >= 3 && <div className="sk-line-3" />}
        {lines >= 4 && <div className="sk-line-4" />}
      </div>
    </div>
  );
}