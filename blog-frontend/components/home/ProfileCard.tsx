"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { api } from "@/lib/api";
import { resolveImageUrl } from "@/lib/url";
import CardSkeleton from "./CardSkeleton";

interface Config {
  author_name?: string;
  author_bio?: string;
  author_avatar?: string;
  social_github?: string;
  social_email?: string;
  social_telegram?: string;
  social_discord?: string;
}
/** /api/site-config/stats 的返回结构 */
interface SiteStats {
  articles: number;
  essays: number;
  photos: number;
  albums: number;
  songs: number;
}

interface SocialLink {
  name: string;
  href: string;
  icon: React.ReactNode;
}

/** 品牌图标（内联 SVG，避免再引入图标库） */
const GitHubIcon = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.55 0-.27-.01-1.17-.02-2.12-3.2.69-3.87-1.36-3.87-1.36-.52-1.33-1.28-1.68-1.28-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.75 2.69 1.25 3.35.95.1-.74.4-1.25.72-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11.1 11.1 0 0 1 2.9-.39c.98 0 1.97.13 2.9.39 2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.8 1.19 1.83 1.19 3.09 0 4.42-2.7 5.39-5.26 5.68.41.35.78 1.05.78 2.12 0 1.53-.01 2.76-.01 3.14 0 .31.21.67.8.55A10.99 10.99 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5z" />
  </svg>
);

const MailIcon = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
    <rect x="2" y="4" width="20" height="16" rx="2" />
    <path d="m2 7 10 6 10-6" />
  </svg>
);

const TelegramIcon = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M22 2 2 10.5l6 2.5L10 22l4-6 6 4 2-18z" />
  </svg>
);

const DiscordIcon = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M20.32 4.37A19.8 19.8 0 0 0 15.45 3c-.2.36-.43.85-.6 1.23a18.3 18.3 0 0 0-5.7 0C8.98 3.85 8.75 3.36 8.54 3a19.7 19.7 0 0 0-4.88 1.37C.57 9.05-.3 13.6.14 18.1a19.9 19.9 0 0 0 6.03 3.03c.48-.66.91-1.36 1.28-2.1-.7-.26-1.37-.59-2-.97.17-.12.33-.25.49-.38a14.2 14.2 0 0 0 12.12 0c.16.13.32.26.49.38-.63.38-1.3.71-2 .97.37.74.8 1.44 1.28 2.1a19.8 19.8 0 0 0 6.03-3.03c.51-5.2-.87-9.71-3.54-13.73zM8.02 15.33c-1.18 0-2.15-1.08-2.15-2.42 0-1.33.95-2.42 2.15-2.42 1.2 0 2.17 1.09 2.15 2.42 0 1.34-.95 2.42-2.15 2.42zm7.96 0c-1.18 0-2.15-1.08-2.15-2.42 0-1.33.95-2.42 2.15-2.42 1.2 0 2.17 1.09 2.15 2.42 0 1.34-.95 2.42-2.15 2.42z" />
  </svg>
);

export default function ProfileCard() {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [stats, setStats] = useState<SiteStats | null>(null);

  useEffect(() => {
    let cancelled = false;

    // 配置与统计各拉一次；统计来自数据库实时计数，
    // 所以后台增删文章/说说/照片后，刷新首页数字就会变。
    api
      .get<{ configs: Record<string, string> }>("/api/site-config")
      .then((d) => {
        if (!cancelled) setCfg(d.configs);
      })
      .catch(() => {
        if (!cancelled) setCfg({});
      });

    api
      .get<SiteStats>("/api/site-config/stats")
      .then((s) => {
        if (!cancelled) setStats(s);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);

  // 加载中：外层自撑满网格单元（首页那一行是 items-stretch），
  // 骨架再 h-full 填满，这样与真实个人卡片同高，加载完成不会跳
  if (cfg === null) {
    return (
      <div className="h-full">
        <CardSkeleton lines={3} />
      </div>
    );
  }

  const name = cfg.author_name || "博主";
  const bio = cfg.author_bio || "在代码与学术间穿梭的普通人";
  const avatarUrl = resolveImageUrl(cfg.author_avatar);

  const socials: SocialLink[] = [
    { name: "GitHub", href: cfg.social_github || "", icon: GitHubIcon },
    { name: "Email", href: cfg.social_email || "", icon: MailIcon },
    { name: "Telegram", href: cfg.social_telegram || "", icon: TelegramIcon },
    { name: "Discord", href: cfg.social_discord || "", icon: DiscordIcon },
  ].filter((s) => s.href);

  const statItems = [
    { label: "文章", value: stats?.articles },
    { label: "说说", value: stats?.essays },
    { label: "照片", value: stats?.photos },
  ];

  return (
    // 注意：这里**不能**用 <Link> 包住整张卡片。
    // 卡片内的社交按钮本身就是 <a>，而 HTML 不允许 <a> 嵌套 <a>，
    // 否则会触发 "In HTML, <a> cannot be a descendant of <a>" 的 hydration 错误。
    // 因此外层改为普通 <div>，只把"头像+姓名+简介"这块做成通往 /about 的链接。
    <div className="glass p-6 flex flex-col h-full card-glow">
      <Link
        href="/about"
        className="profile-card-link"
        title="查看关于我"
      >
        <div className="relative w-16 h-16 rounded-full overflow-hidden border-2 border-white/20 flex-shrink-0">
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={name}
              className="w-full h-full object-cover"
              onError={(e) =>
                ((e.target as HTMLImageElement).style.display = "none")
              }
            />
          ) : (
            <div
              className="w-full h-full flex items-center justify-center text-2xl text-white"
              style={{ background: "var(--accent)" }}
            >
              {name[0]}
            </div>
          )}
        </div>
        <div className="min-w-0">
          <h2 className="text-lg font-bold truncate">{name}</h2>
          <p
            className="text-xs mt-1 line-clamp-2"
            style={{ color: "var(--text-secondary)" }}
          >
            {bio}
          </p>
        </div>
      </Link>

      {/* 实时统计：数字来自 /api/site-config/stats（数据库实时计数） */}
      <div className="flex gap-6 mb-5">
        {statItems.map((s) => (
          <div key={s.label} className="text-center">
            <div
              className="text-lg font-bold tabular-nums"
              style={{ color: "var(--accent)" }}
            >
              {s.value ?? "—"}
            </div>
            <div className="text-xs" style={{ color: "var(--text-secondary)" }}>
              {s.label}
            </div>
          </div>
        ))}
      </div>

      {socials.length > 0 && (
        <div className="profile-socials mt-auto">
          {socials.map((s) => (
            <a
              key={s.name}
              href={s.href}
              title={s.name}
              aria-label={s.name}
              className="profile-social-btn"
              target="_blank"
              rel="noopener noreferrer"
            >
              {s.icon}
              <span className="profile-social-btn__label">{s.name}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
