"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "@/lib/api";
import { resolveImageUrl } from "@/lib/url";

/**
 * 成员关于页（阶段 3）
 *
 * 数据来自 /api/members/{username}，只对在后台打开了「公开」的账号可见；
 * 未公开或不存在都返回 404，这里统一显示"没有这个成员"。
 */
interface MemberDetail {
  username: string;
  name: string;
  avatar: string | null;
  bio: string | null;
  social_github: string | null;
  social_email: string | null;
  social_telegram: string | null;
  social_discord: string | null;
  about_subtitle: string | null;
  about_banner: string | null;
  about_content: string | null;
  is_admin: boolean;
}

export default function MemberDetailPage() {
  const params = useParams<{ username: string }>();
  const username = decodeURIComponent(String(params?.username ?? ""));
  const [data, setData] = useState<MemberDetail | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!username) return;
    let alive = true;
    api
      .get<MemberDetail>(`/api/members/${encodeURIComponent(username)}`)
      .then((d) => {
        if (alive) setData(d);
      })
      .catch(() => {
        if (alive) setNotFound(true);
      });
    return () => {
      alive = false;
    };
  }, [username]);

  if (notFound) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <p className="text-lg font-medium">没有这个成员</p>
        <Link
          href="/members"
          className="mt-4 inline-block text-sm"
          style={{ color: "var(--accent)" }}
        >
          看看其他成员
        </Link>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10 text-sm" style={{ color: "var(--text-secondary)" }}>
        加载中...
      </div>
    );
  }

  const socials = [
    { label: "GitHub", href: data.social_github },
    { label: "Email", href: data.social_email ? `mailto:${data.social_email}` : null },
    { label: "Telegram", href: data.social_telegram },
    { label: "Discord", href: data.social_discord },
  ].filter((s) => s.href);

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      {/* 横幅 */}
      {data.about_banner ? (
        <div
          className="mb-6 h-40 w-full overflow-hidden rounded-xl bg-white/5"
          style={{
            backgroundImage: `url(${resolveImageUrl(data.about_banner)})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        />
      ) : null}

      {/* 头部：头像 + 名字 + 简介 */}
      <div className="flex items-center gap-4">
        <span
          className="flex h-16 w-16 flex-none items-center justify-center overflow-hidden rounded-full text-lg"
          style={{ background: "rgba(124,92,255,0.18)", color: "var(--accent)" }}
        >
          {data.avatar ? (
            <img
              src={resolveImageUrl(data.avatar)}
              alt={data.name}
              className="h-full w-full object-cover"
            />
          ) : (
            data.name.slice(0, 1)
          )}
        </span>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">{data.name}</h1>
          {data.about_subtitle ? (
            <p className="text-xs tracking-widest" style={{ color: "var(--text-secondary)" }}>
              {data.about_subtitle}
            </p>
          ) : null}
        </div>
      </div>

      {data.bio ? (
        <p className="mt-4 text-sm" style={{ color: "var(--text-secondary)" }}>
          {data.bio}
        </p>
      ) : null}

      {/* 社交链接 */}
      {socials.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {socials.map((s) => (
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

      {/* 关于页正文 */}
      {data.about_content ? (
        <article className="prose prose-invert mt-8 max-w-none text-sm leading-7">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {data.about_content}
          </ReactMarkdown>
        </article>
      ) : (
        <p className="mt-8 text-sm" style={{ color: "var(--text-secondary)" }}>
          这个人还没写关于自己。
        </p>
      )}

      <Link
        href="/members"
        className="mt-10 inline-block text-sm"
        style={{ color: "var(--accent)" }}
      >
        ← 全部成员
      </Link>
    </div>
  );
}
