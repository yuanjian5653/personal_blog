"use client";

import { useEffect, useState } from "react";

import { fetchMembers, type Member } from "@/lib/members";

/**
 * 成员权限一览（仅管理员）
 *
 * 管理员在音乐 / 项目管理页要能一眼看出"谁能传音乐、谁能同步项目"，
 * 不用来回切到「成员管理」去查。
 *
 * 数据直接复用 /api/admin/members，不新增接口。
 */
export default function MemberPermPanel({
  kind,
}: {
  /** music = 关注网易云；project = 关注 GitHub */
  kind: "music" | "project";
}) {
  const [members, setMembers] = useState<Member[] | null>(null);

  useEffect(() => {
    let alive = true;
    fetchMembers()
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

  if (members === null) return null;
  // 只有管理员能拿到除自己以外的账号；成员这里会是 1 条（自己），直接不显示
  if (members.length <= 1) return null;

  const field = kind === "music" ? "netease_enabled" : "github_enabled";
  const label = kind === "music" ? "网易云" : "GitHub 同步";

  return (
    <div className="admin-panel space-y-2">
      <div className="admin-panel__title">成员{label}权限</div>
      <div className="flex flex-wrap gap-2">
        {members
          .filter((m) => m.role === "member")
          .map((m) => {
            const on = Boolean(m[field]);
            return (
              <span
                key={m.id}
                className={
                  on
                    ? "admin-badge admin-badge--approved"
                    : "admin-badge admin-badge--muted"
                }
                title={`${m.display_name || m.username} · ${on ? "已开通" : "未开通"}`}
              >
                {m.display_name || m.username}
                {on ? " ✓" : " ✕"}
              </span>
            );
          })}
      </div>
      <p className="admin-muted text-xs">
        在「成员管理」里可以逐个开关。这里只是让你在传音乐 / 同步项目时
        一眼看出谁有权限。
      </p>
    </div>
  );
}
