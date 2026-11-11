"use client";

import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import AboutFab, { type FabOption } from "@/components/about/AboutFab";
import { api } from "@/lib/api";
import { resolveImageUrl } from "@/lib/url";

/**
 * 关于页面（唯一入口）
 *
 * 内容分两类，用右下角的浮动切换器切换：
 *   网站介绍  ← 站点配置里的 site_intro_*
 *   站长 / 各成员 ← 各自的关于内容（author_profiles）
 *
 * 切换器放在右下角而不是页面顶部：
 *   顶部一排按钮会把正文往下压，而且人一多就挤成两行。
 *   浮动按钮不占版面，主按钮还直接显示"当前在看谁"。
 *
 * 数据来源严格分开（这是之前踩过的坑）：
 *   网站介绍 → site_intro_subtitle / banner / content
 *   站长     → about_subtitle / banner / content（「关于内容」页）
 *   成员     → 各自的 author_profiles
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
  // 每个成员的详情缓存：来回切换不再重复请求。
  // 用 state 而不是 ref + effect，是为了让 detail / loading 成为**派生值** ——
  // 在 effect 里同步 setState 会被 react-hooks/set-state-in-effect 拦下。
  const [cache, setCache] = useState<Record<string, MemberDetail>>({});

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

  // 切到某个人时取详情；已有缓存就什么都不做（detail 是派生的）
  useEffect(() => {
    if (tab === SITE_TAB || cache[tab]) return;
    let alive = true;
    api
      .get<MemberDetail>(`/api/members/${encodeURIComponent(tab)}`)
      .then((d) => {
        if (alive) setCache((prev) => ({ ...prev, [tab]: d }));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [tab, cache]);

  const options: FabOption[] = useMemo(
    () => [
      { key: SITE_TAB, name: "网站介绍", avatar: null },
      ...members.map((m) => ({
        key: m.username,
        name: m.name,
        avatar: m.avatar,
      })),
    ],
    [members]
  );

  const isSite = tab === SITE_TAB;
  const detail = isSite ? null : cache[tab] ?? null;
  const loadingDetail = !isSite && !detail;
  const banner = resolveImageUrl(
    isSite ? cfg.site_intro_banner : detail?.about_banner
  );
  const subtitle = isSite
    ? cfg.site_intro_subtitle || "ABOUT"
    : detail?.about_subtitle || null;
  const content = isSite
    ? cfg.site_intro_content || ""
    : detail?.about_content || "";

  const socials = detail
    ? [
        { label: "GitHub", href: detail.social_github },
        {
          label: "Email",
          href: detail.social_email ? `mailto:${detail.social_email}` : null,
        },
        { label: "Telegram", href: detail.social_telegram },
        { label: "Discord", href: detail.social_discord },
      ].filter((s) => s.href)
    : [];

  return (
    <div className="about-page mx-auto max-w-3xl px-4 pb-24 pt-10">
      {/* key 变化时重新挂载 → 触发淡入动画 */}
      <div className="about-pane" key={tab}>
        {/* 横幅 */}
        {banner ? (
          <div
            className="about-banner mb-6"
            style={{ backgroundImage: `url(${banner})` }}
          />
        ) : null}

        {/* 个人页头部（网站介绍不显示头像） */}
        {!isSite && detail ? (
          <div className="mb-5 flex items-center gap-4">
            <span className="about-avatar">
              {detail.avatar ? (
                <img decoding="async"
                  src={resolveImageUrl(detail.avatar) ?? ""}
                  alt={detail.name}
                  className="h-full w-full object-cover"
                />
              ) : (
                detail.name.slice(0, 1)
              )}
            </span>
            <div className="min-w-0">
              <h1 className="text-2xl font-bold leading-tight">{detail.name}</h1>
              {detail.bio ? (
                <p
                  className="mt-1 text-xs leading-relaxed"
                  style={{ color: "var(--text-secondary)" }}
                >
                  {detail.bio}
                </p>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="mb-5">
            <h1 className="about-hero-title">关于本站</h1>
          </div>
        )}

        {subtitle ? (
          <p
            className="mb-4 text-[11px] uppercase tracking-[0.22em]"
            style={{ color: "var(--text-secondary)" }}
          >
            {subtitle}
          </p>
        ) : null}

        {/* 社交链接（个人页才有） */}
        {!isSite && socials.length > 0 ? (
          <div className="mb-6 flex flex-wrap gap-2">
            {socials.map((s) => (
              <a
                key={s.label}
                href={s.href as string}
                target="_blank"
                rel="noreferrer"
                className="about-social"
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
          <article className="about-prose">
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

      {/* 右下角的切换器 */}
      <AboutFab
        options={options}
        current={tab}
        onSelect={setTab}
      />
    </div>
  );
}
