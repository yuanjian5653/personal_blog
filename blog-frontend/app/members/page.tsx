"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { resolveImageUrl } from "@/lib/url";

/**
 * 成员列表（阶段 3）
 *
 * 只列在「关于内容 → 其他设置」里打开了「公开我的关于页」的账号。
 * 默认关闭，所以这个页面一开始是空的 —— 这是预期行为。
 */
interface MemberItem {
  username: string;
  name: string;
  avatar: string | null;
  bio: string | null;
}

export default function MembersPage() {
  const [members, setMembers] = useState<MemberItem[] | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .get<MemberItem[]>("/api/members")
      .then((rows) => {
        if (alive) setMembers(rows);
      })
      .catch(() => {
        if (alive) setMembers([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <Link href="/" className="mb-2 inline-block text-xs" style={{ color: "var(--accent)" }}>
        ← 回首页
      </Link>
      <h1 className="text-2xl font-bold mb-2">成员</h1>
      <p className="text-sm mb-8" style={{ color: "var(--text-secondary)" }}>
        一起在这里写字的人。
      </p>

      {members === null ? (
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          加载中...
        </p>
      ) : members.length === 0 ? (
        <div className="glass p-10 text-center text-sm" style={{ borderRadius: 12, color: "var(--text-secondary)" }}>
          还没有公开的成员。
          <br />
          （成员可在后台「关于内容 → 其他设置」里打开公开）
        </div>
      ) : (
        <div className="space-y-3">
          {members.map((m) => (
            <Link
              key={m.username}
              href={`/members/${encodeURIComponent(m.username)}`}
              className="glass flex items-center gap-4 p-4 hover:bg-white/5 transition-colors"
              style={{ borderRadius: 12 }}
            >
              <span
                className="flex h-12 w-12 flex-none items-center justify-center overflow-hidden rounded-full text-sm"
                style={{ background: "rgba(124,92,255,0.18)", color: "var(--accent)" }}
              >
                {m.avatar ? (
                  // 头像尺寸小、来源不确定，不值得走 next/image
                  <img
                    src={resolveImageUrl(m.avatar)}
                    alt={m.name}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  m.name.slice(0, 1)
                )}
              </span>
              <span className="min-w-0">
                <span className="block font-medium">{m.name}</span>
                {m.bio ? (
                  <span
                    className="block truncate text-xs"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    {m.bio}
                  </span>
                ) : null}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
