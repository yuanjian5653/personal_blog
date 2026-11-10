"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "@/lib/api";
import { resolveImageUrl } from "@/lib/url";

/**
 * 关于页面（唯一入口）
 *
 * 顶部一排切换：
 *     网站介绍   zwj   成员A   成员B …
 * 默认选中「网站介绍」，其余是每个已公开成员的关于页（站长始终在里面）。
 *
 * 这样 /about 既是"这个站是什么"，也能一键切到"这个人是谁"，
 * 不用在两个页面之间来回跳。
 */

interface SiteCfg {
  site_intro_subtitle?: string;
  site_intro_banner?: string;
  site_intro_content?: string;
}

interface MemberItem {
  username: string;
  name: string;
  avatar: string | null;
  bio: string | null;
}

interface MemberDetail extends MemberItem {
  social_github: string | null;
  social_email: string | null;
  social_telegram: string | null;
  social_discord: string | null;
  about_subtitle: string | null;
  about_banner: string | null;
  about_content: string | null;
  is_admin: boolean;
}

const SITE_TAB = "__site__";

export default function AboutPage() {
  const [cfg, setCfg] = useState<SiteCfg>({});
  const [members, setMembers] = useState<MemberItem[]>([]);
  // 支持 /about?tab=用户名 —— 首页个人卡片点进来会带上它。
  // 用惰性初始化而不是在 effect 里 setState：
  // 后者会被 react-hooks/set-state-in-effect 判为级联渲染。
  const [tab, setTab] = useState<string>(() => {
    if (typeof window === "undefined") return SITE_TAB;
    const param = new URLSearchParams(window.location.search).get("tab");
    return param || SITE_TAB;
  });
  const [detail, setDetail] = useState<MemberDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  // 每个成员的详情缓存起来：来回切换不再重复请求（切换卡顿的主因）
  const cacheRef = useRef<Map<string, MemberDetail>>(new Map());

  // 站点介绍 + 成员列表（一次拉全）
  useEffect(() => {
    let alive = true;
    api
      .get<{ configs: SiteCfg }>("/api/site-config")
      .then((r) => {
        if (alive) setCfg(r.configs ?? {});
      })
      .catch(() => undefined);
    api
      .get<MemberItem[]>("/api/members")
      .then((rows) => {
        if (alive) setMembers(rows);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  // 切到某个人时取详情；命中缓存就直接用，避免每次都等网络
  useEffect(() => {
    if (tab === SITE_TAB) return;
    const cached = cacheRef.current.get(tab);
    if (cached) {
      setDetail(cached);
      setLoadingDetail(false);
      return;
    }
    let alive = true;
    api
      .get<MemberDetail>(`/api/members/${encodeURIComponent(tab)}`)
      .then((d) => {
        if (alive) {
          cacheRef.current.set(tab, d);
          setDetail(d);
          setLoadingDetail(false);
        }
      })
      .catch(() => {
        if (alive) setLoadingDetail(false);
      });
    return () => {
      alive = false;
    };
  }, [tab]);

  const tabs = useMemo(
    () => [
      { username: SITE_TAB, name: "网站介绍", avatar: null as string | null },
      ...members,
    ],
    [members]
  );

  const isSite = tab === SITE_TAB;
  const banner = resolveImageUrl(
    isSite ? cfg.site_intro_banner : detail?.about_banner
  );
  const subtitle = isSite
    ? cfg.site_intro_subtitle || "ABOUT"
    : detail?.about_subtitle || null;
  const content = isSite
    ? cfg.site_intro_content || ""
    : detail?.about_content || "";

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      {/* 切换：网站介绍 / 每位成员（含站长） */}
      <div className="mb-8 flex flex-wrap gap-2">
        {tabs.map((t) => {
          const active = t.username === tab;
          return (
            <button
              key={t.username}
              type="button"
              onClick={() => {
                setTab(t.username);
                if (t.username !== SITE_TAB) setLoadingDetail(true);
              }}
              className="flex items-center gap-2 rounded-full px-3 py-1 text-xs transition-all duration-200 hover:opacity-90 active:scale-95"
              style={{
                background: active ? "rgba(124,92,255,0.18)" : "transparent",
                border: `1px solid ${active ? "var(--accent)" : "var(--card-border)"}`,
                color: active ? "var(--accent)" : "var(--text-secondary)",
              }}
            >
              {t.avatar ? (
                <img
                  src={resolveImageUrl(t.avatar) ?? ""}
                  alt={t.name}
                  className="h-5 w-5 rounded-full object-cover"
                />
              ) : null}
              {t.name}
            </button>
          );
        })}
      </div>

      {/* 横幅 */}
      {banner ? (
        <div
          className="mb-6 h-40 w-full overflow-hidden rounded-xl bg-white/5"
          style={{
            backgroundImage: `url(${banner})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        />
      ) : null}

      {/* 个人页头部（网站介绍不显示头像） */}
      {!isSite && detail ? (
        <div className="mb-4 flex items-center gap-4">
          <span
            className="flex h-16 w-16 flex-none items-center justify-center overflow-hidden rounded-full text-lg"
            style={{ background: "rgba(124,92,255,0.18)", color: "var(--accent)" }}
          >
            {detail.avatar ? (
              <img
                src={resolveImageUrl(detail.avatar) ?? ""}
                alt={detail.name}
                className="h-full w-full object-cover"
              />
            ) : (
              detail.name.slice(0, 1)
            )}
          </span>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold">{detail.name}</h1>
            {detail.bio ? (
              <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                {detail.bio}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      {subtitle ? (
        <p
          className="mb-4 text-xs tracking-widest"
          style={{ color: "var(--text-secondary)" }}
        >
          {subtitle}
        </p>
      ) : null}

      {/* 社交链接（个人页才有） */}
      {!isSite && detail ? (
        <div className="mb-6 flex flex-wrap gap-2">
          {[
            { label: "GitHub", href: detail.social_github },
            {
              label: "Email",
              href: detail.social_email ? `mailto:${detail.social_email}` : null,
            },
            { label: "Telegram", href: detail.social_telegram },
            { label: "Discord", href: detail.social_discord },
          ]
            .filter((s) => s.href)
            .map((s) => (
              <a
                key={s.label}
                href={s.href as string}
                target="_blank"
                rel="noreferrer"
                className="rounded-full px-3 py-1 text-xs"
                style={{
                  border: "1px solid var(--card-border)",
                  color: "var(--text-secondary)",
                }}
              >
                {s.label}
              </a>
            ))}
        </div>
      ) : null}

      {/* 正文 */}
      {!isSite && loadingDetail && !detail ? (
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          加载中...
        </p>
      ) : content ? (
        <article className="prose prose-invert max-w-none text-sm leading-7">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        </article>
      ) : (
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          {isSite
            ? "还没有写网站介绍。（后台 → 站点配置 → 网站介绍）"
            : "这个人还没写关于自己。"}
        </p>
      )}
    </div>
  );
}
