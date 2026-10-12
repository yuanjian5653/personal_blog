"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

/**
 * 页面切换动画容器
 * 挂在 layout 里包裹主内容，路径变化时重新触发动画。
 * 注意：不卸载 children，避免重挂载导致卡顿。
 */
export default function PageTransition({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const ref = useRef<HTMLDivElement>(null);
  const isAdmin = pathname.startsWith("/admin");

  useEffect(() => {
    if (isAdmin) return;
    const el = ref.current;
    if (!el) return;
    // 移除动画类 → 强制重排 → 重新添加，触发动画重播
    el.classList.remove("page-enter");
    // 读取 offsetWidth 强制浏览器回流，让动画能重新执行
    void el.offsetWidth;
    el.classList.add("page-enter");
  }, [pathname, isAdmin]);

  // 后台不做动画
  if (isAdmin) return <>{children}</>;

  return (
    <div ref={ref} className="page-enter">
      {children}
    </div>
  );
}