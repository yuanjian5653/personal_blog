"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { formatClock } from "@/lib/format";

export default function FooterInfo() {
  const [time, setTime] = useState("");
  const [uptime, setUptime] = useState("");
  const [icp, setIcp] = useState("");
  const [startedAt, setStartedAt] = useState<string>("");

  // 时钟
  useEffect(() => {
    const update = () => setTime(formatClock());
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, []);

  // 运行时长
  useEffect(() => {
    if (!startedAt) return;
    const update = () => {
      const start = new Date(startedAt).getTime();
      if (isNaN(start)) {
        setUptime("");
        return;
      }
      const diff = Date.now() - start;
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
      setUptime(`${days}天${hours}小时`);
    };
    update();
    const timer = setInterval(update, 60 * 1000);
    return () => clearInterval(timer);
  }, [startedAt]);

  // 配置
  useEffect(() => {
    api
      .get<{ configs: Record<string, string> }>("/api/site-config")
      .then((d) => {
        setIcp(d.configs.icp_number || "");
        setStartedAt(d.configs.site_started_at || "");
      })
      .catch(() => {});
  }, []);

  return (
    <div className="footer-info-bar">
      {/* 左侧：时钟 */}
      <div className="footer-info-clock">
        <span>{time || "00:00:00"}</span>
      </div>

      {/* 中间：运行时长 */}
      <div className="footer-info-uptime">
        <span className="footer-info-dot" />
        <span>系统已稳定运行：</span>
        <span className="footer-info-uptime-value">
          {uptime || "—"}
        </span>
      </div>

      {/* 技术栈标签 */}
      <div className="footer-info-stack">
        <span className="footer-info-tag">
          {/* Next.js 图标 */}
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
            <path d="M11.214 12.6c0 3.6-2.214 5.414-5.4 5.414-3.6 0-5.4-2.014-5.4-5.4v-6.6h1.886v6.6c0 2.4 1.014 3.6 3.514 3.6s3.514-1.2 3.514-3.6v-6.6h1.886v6.586zM17.786 18h-1.886V6h1.886v12z" />
          </svg>
          Next.js 15
        </span>

        <span className="footer-info-tag">
          {/* React 图标 */}
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="12" r="2" />
            <g fill="none" stroke="currentColor" strokeWidth="1.2">
              <ellipse cx="12" cy="12" rx="10" ry="4" />
              <ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(60 12 12)" />
              <ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(-60 12 12)" />
            </g>
          </svg>
          React 19
        </span>

        <span className="footer-info-tag">
          {/* Tailwind 图标（波浪） */}
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 6c-2.67 0-4.33 1.33-5 4 1-1.33 2.17-1.83 3.5-1.5.76.19 1.31.74 1.91 1.35.98 1 2.12 2.15 4.59 2.15 2.67 0 4.33-1.33 5-4-1 1.33-2.17 1.83-3.5 1.5-.76-.19-1.31-.74-1.91-1.35C15.61 7.15 14.47 6 12 6zm-5 6c-2.67 0-4.33 1.33-5 4 1-1.33 2.17-1.83 3.5-1.5.76.19 1.31.74 1.91 1.35.98 1 2.12 2.15 4.59 2.15 2.67 0 4.33-1.33 5-4-1 1.33-2.17 1.83-3.5 1.5-.76-.19-1.31-.74-1.91-1.35C10.61 13.15 9.47 12 7 12z" />
          </svg>
          Tailwind 4
        </span>
      </div>

      {/* 备案号 */}
      {icp && <div className="footer-info-icp">{icp}</div>}
    </div>
  );
}