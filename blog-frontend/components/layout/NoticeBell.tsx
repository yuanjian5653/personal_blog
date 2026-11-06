"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Bell } from "lucide";
import { MorphIcon } from "morphicons/react";

import {
  NOTICES_READ_EVENT,
  fetchUnreadCount,
} from "@/lib/replyNotify";

/**
 * 导航栏里的回复通知铃铛 + 红点。
 *
 * 三个刻意的决定：
 *
 * 1. **只发一个请求判断登录态**
 *    `/api/notifications/unread-count` 成功 = 已登录，失败 = 未登录。
 *    不需要先问 /api/comments/me 再问一次未读数。
 *
 * 2. **60 秒轮询，且页面不可见时跳过**
 *    红点不值得每秒轮询；`document.hidden` 时直接跳过，
 *    省掉后台标签页的无意义请求（服务器只有 1 Mbps 带宽）。
 *
 * 3. **监听自定义事件即时清零**
 *    用户点"全部已读"后不等下一次轮询，立刻把红点去掉。
 */
const POLL_INTERVAL = 60_000;

export default function NoticeBell() {
  // null = 还不知道（不渲染，避免未登录用户闪一下铃铛）
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [count, setCount] = useState(0);
  const pathname = usePathname();

  // 每次路由变化重新问一次：从"未登录"到登录回来（OAuth 跳转后）能立刻反映
  useEffect(() => {
    let alive = true;

    const load = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      fetchUnreadCount()
        .then((r) => {
          if (!alive) return;
          setLoggedIn(true);
          setCount(r.count);
        })
        .catch(() => {
          if (!alive) return;
          // 401 或网络错误：一律当作"没有红点"，不打扰用户
          setLoggedIn(false);
          setCount(0);
        });
    };

    load();
    const timer = window.setInterval(load, POLL_INTERVAL);

    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [pathname]);

  // 在通知页点了"全部已读"：立刻清零
  useEffect(() => {
    const onRead = () => setCount(0);
    window.addEventListener(NOTICES_READ_EVENT, onRead);
    return () => window.removeEventListener(NOTICES_READ_EVENT, onRead);
  }, []);

  if (!loggedIn) return null;

  const label = count > 0 ? `${count} 条未读通知` : "通知";

  return (
    <Link
      href="/notifications"
      className="notice-bell"
      aria-label={label}
      title={label}
    >
      {/* lucide 在这个项目里导出的是图标数据（IconNode），不是组件，
          必须经 MorphIcon 渲染 —— 直接 <Bell /> 会报
          "does not have any construct or call signatures"。 */}
      <MorphIcon icon={Bell} size={17} />
      {count > 0 && (
        <span className="notice-bell__dot" aria-hidden="true">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}
