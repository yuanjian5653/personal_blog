"use client";

import Link from "next/link";
import { useCachedFetch } from "@/lib/useCachedFetch";
import { api } from "@/lib/api";
import { resolveImageUrl } from "@/lib/url";
import CardSkeleton from "./CardSkeleton";

interface Config {
  author_name?: string;
  author_bio?: string;
  author_avatar?: string;
  author_stats_articles?: string;
  author_stats_posts?: string;
  author_stats_photos?: string;
  social_github?: string;
  social_email?: string;
  social_telegram?: string;
  social_discord?: string;
}

export default function ProfileCard() {
  const { data, loading } = useCachedFetch<{
    configs: Record<string, string>;
  }>(
    "site_config_cache",
    () => api.get<{ configs: Record<string, string> }>("/api/site-config"),
    5 * 60 * 1000
  );

  // 首次加载且无缓存 → 显示骨架
  if (loading && !data) {
    return <CardSkeleton lines={3} />;
  }

  const cfg: Config = data?.configs || {};
  const name = cfg.author_name || "博主";
  const bio = cfg.author_bio || "在代码与学术间穿梭的普通人";
  const avatar = cfg.author_avatar || "";

  const avatarUrl = resolveImageUrl(avatar);

  const socials = [
    { name: "GitHub", href: cfg.social_github, icon: "GH" },
    { name: "Email", href: cfg.social_email, icon: "@" },
    { name: "Telegram", href: cfg.social_telegram, icon: "TG" },
    { name: "Discord", href: cfg.social_discord, icon: "DC" },
  ].filter((s) => s.href);

  const stats = [
    { label: "文章", value: cfg.author_stats_articles || "0" },
    { label: "说说", value: cfg.author_stats_posts || "0" },
    { label: "照片", value: cfg.author_stats_photos || "0" },
  ];

  return (
    <Link
      href="/about"
      className="glass p-6 flex flex-col h-full card-glow block cursor-pointer"
    >
      <div className="flex items-center gap-4 mb-5">
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
      </div>

      <div className="flex gap-6 mb-5">
        {stats.map((s) => (
          <div key={s.label} className="text-center">
            <div
              className="text-lg font-bold"
              style={{ color: "var(--accent)" }}
            >
              {s.value}
            </div>
            <div className="text-xs" style={{ color: "var(--text-secondary)" }}>
              {s.label}
            </div>
          </div>
        ))}
      </div>

      {socials.length > 0 && (
        <div className="flex gap-2 mt-auto">
          {socials.map((s) => (
            <span
              key={s.name}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                window.open(s.href, "_blank");
              }}
              className="w-9 h-9 rounded-full flex items-center justify-center text-xs transition-colors hover:bg-white/10 cursor-pointer"
              style={{ border: "1px solid var(--glass-border)" }}
              title={s.name}
            >
              {s.icon}
            </span>
          ))}
        </div>
      )}
    </Link>
  );
}