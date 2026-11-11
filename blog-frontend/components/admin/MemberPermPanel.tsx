"use client";

import { useEffect, useState } from "react";
import { MorphIcon } from "morphicons/react";
import { PlugZap } from "lucide";

import { api } from "@/lib/api";
import { fetchMembers, type Member } from "@/lib/members";

/**
 * 成员凭据状态（仅管理员）
 *
 * 管理员在音乐 / 项目管理页要能一眼看出"谁配好了、谁真的能用"，
 * 不用来回切到「成员管理」去查。
 *
 * 显示的是**登录 / 配置状态**，不是授权开关：
 *   未配置        —— 成员还没填自己的凭据
 *   已配置·未检测 —— 填了，但没验证过
 *   登录成功      —— 点了「检测」并且真的通
 *   不可用        —— 检测失败（Cookie 过期 / Token 失效）
 *
 * 「检测」会真拿这个成员的凭据去请求一次外部接口，所以不自动跑 ——
 * 一次性验证所有人会拖慢页面，也白白消耗对方接口的额度。
 */
type VerifyState = { ok: boolean; detail: string };

export default function MemberPermPanel({
  kind,
}: {
  /** music = 看网易云；project = 看 GitHub */
  kind: "music" | "project";
}) {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [verifying, setVerifying] = useState<number | null>(null);
  const [results, setResults] = useState<Record<number, VerifyState>>({});

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

  const hasCred = (m: Member) =>
    kind === "music" ? m.has_netease_cookie : m.has_github_token;

  const verify = async (m: Member) => {
    setVerifying(m.id);
    try {
      const r = await api.post<VerifyState>(
        `/api/admin/members/${m.id}/verify-credential`,
        { kind: kind === "music" ? "netease" : "github" }
      );
      setResults((prev) => ({ ...prev, [m.id]: r }));
    } catch (e) {
      setResults((prev) => ({
        ...prev,
        [m.id]: {
          ok: false,
          detail: e instanceof Error ? e.message : "验证失败",
        },
      }));
    } finally {
      setVerifying(null);
    }
  };

  if (members === null) return null;
  const list = members.filter((m) => m.role === "member");
  if (list.length === 0) return null;

  const label = kind === "music" ? "网易云" : "GitHub";

  return (
    <div className="admin-panel space-y-2">
      <div className="admin-panel__title">成员{label}登录情况</div>

      <div className="space-y-1.5">
        {list.map((m) => {
          const r = results[m.id];
          const configured = hasCred(m);
          return (
            <div
              key={m.id}
              className="flex items-center justify-between gap-3 flex-wrap"
            >
              <span className="admin-user__name">
                {m.display_name || m.username}
              </span>

              <span className="flex items-center gap-2">
                {r ? (
                  <span
                    className={
                      r.ok
                        ? "admin-badge admin-badge--approved"
                        : "admin-badge admin-badge--rejected"
                    }
                    title={r.detail}
                  >
                    {r.ok ? "登录成功" : "不可用"}
                  </span>
                ) : configured ? (
                  <span
                    className="admin-badge admin-badge--muted"
                    title="已填凭据，但还没验证是否可用"
                  >
                    已配置 · 未检测
                  </span>
                ) : (
                  <span className="admin-badge admin-badge--muted">未配置</span>
                )}

                {configured && (
                  <button
                    type="button"
                    className="admin-link"
                    disabled={verifying === m.id}
                    onClick={() => void verify(m)}
                  >
                    <MorphIcon icon={PlugZap} size={12} />
                    {verifying === m.id ? "检测中…" : "检测"}
                  </button>
                )}
              </span>
            </div>
          );
        })}
      </div>

      <p className="admin-muted text-xs">
        {kind === "music"
          ? "「检测」会拿该成员自己的网易云 Cookie 请求一次网易云，确认是否还有效。"
          : "「检测」会拿该成员自己的 GitHub Token 请求一次 GitHub，确认是否还有效。"}
        凭据由成员在「音乐管理 / 项目管理」里自己填，能不能用在这里确认。
      </p>
    </div>
  );
}
