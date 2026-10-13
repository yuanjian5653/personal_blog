"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

import { API_BASE } from "@/lib/api";

/**
 * 前台访问埋点：每次路径变化上报一次，供后台仪表盘统计"访客趋势 / 浏览器分布"。
 *
 * 几个注意点：
 * - 挂在根布局里，**后台页面也挂载**，所以这里跳过 /admin（后端也会再挡一道）
 * - 用 fetch keepalive，这样用户快速离开页面时请求不容易被取消
 * - 失败静默：统计不该影响任何正常功能
 */
export default function VisitTracker() {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname || pathname.startsWith("/admin")) return;

    const url = `${API_BASE}/api/admin/track`;
    const body = JSON.stringify({ path: pathname });

    // keepalive 让请求在页面卸载时也能发出去
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      credentials: "include",
      keepalive: true,
    }).catch(() => {});
  }, [pathname]);

  return null;
}
