"use client";

import { useCallback, useEffect, useState } from "react";
import { MorphIcon } from "morphicons/react";
import { Plus, RefreshCw, Trash2, UserCog } from "lucide";

import {
  Member,
  MemberCreateInput,
  ROLE_HINT,
  createMember,
  deleteMember,
  emptyMemberInput,
  fetchMembers,
  resetMemberPassword,
  updateMember,
} from "@/lib/members";

/**
 * 成员管理（仅管理员）。
 *
 * 样式遵循后台既有页面的约定（与 friends / easter-eggs 两页一致）：
 *   · 骨架用 Tailwind 工具类：space-y-4 / flex items-center justify-between
 *   · 面板用 .admin-panel + .admin-panel__title
 *   · 表单用 .admin-filters > .admin-field，label 里的文字必须包在 <span> 里
 *     （.admin-field 的排版规则是按 span + input 写的）
 *   · 表格用 .admin-table，单元格里的次要信息用 .admin-muted text-xs
 *   · 操作入口用 .admin-link / .admin-link--danger，不用 select（后台没有 select 样式）
 */
export default function MembersPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<MemberCreateInput>(emptyMemberInput());
  const [saving, setSaving] = useState(false);
  /** 新建成功后显示一次的初始密码 */
  const [newPassword, setNewPassword] = useState<{ user: string; pw: string } | null>(
    null
  );

  const load = useCallback(async () => {
    try {
      setMembers(await fetchMembers());
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  // 首次加载：异步结果在回调里 setState（effect 体内不能同步 setState）
  useEffect(() => {
    let alive = true;
    fetchMembers()
      .then((rows) => {
        if (alive) setMembers(rows);
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : "加载失败");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const flash = (msg: string) => {
    setNotice(msg);
    window.setTimeout(() => setNotice(""), 4000);
  };

  const handleCreate = async () => {
    setSaving(true);
    setError("");
    try {
      const res = await createMember(form);
      setNewPassword({ user: res.member.username, pw: res.password });
      setShowForm(false);
      setForm(emptyMemberInput());
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "创建失败");
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async (m: Member, role: "admin" | "member" | undefined, status?: "active" | "disabled") => {
    setError("");
    try {
      await updateMember(m.id, {
        ...(role ? { role } : {}),
        ...(status ? { status } : {}),
      });
      flash(`已更新 ${m.display_name || m.username}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "更新失败");
    }
  };

  const handleResetPassword = async (m: Member) => {
    const pw = window.prompt(
      `给 ${m.display_name || m.username} 设置新密码（至少 12 位）：`
    );
    if (!pw) return;
    setError("");
    try {
      await resetMemberPassword(m.id, pw);
      flash("密码已重置，该账号需要重新登录");
    } catch (e) {
      setError(e instanceof Error ? e.message : "重置失败");
    }
  };

  const handleDelete = async (m: Member) => {
    if (
      !window.confirm(
        `停用 ${m.display_name || m.username}？\n\n` +
          "账号会被停用（不能登录），但记录和操作日志保留、ta 发布的内容不删。"
      )
    ) {
      return;
    }
    setError("");
    try {
      await deleteMember(m.id);
      flash("已停用");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "停用失败");
    }
  };

  return (
    <div className="space-y-4">
      {/* 头部 */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold">成员管理</h1>
        <div className="admin-actions">
          <span className="admin-muted text-xs">
            {members.length ? `共 ${members.length} 个账号` : ""}
          </span>
          <button
            type="button"
            className="admin-btn admin-btn--ghost"
            onClick={() => {
              setError("");
              void load();
            }}
          >
            <MorphIcon icon={RefreshCw} size={14} /> 刷新
          </button>
          <button
            type="button"
            className="admin-btn"
            onClick={() => {
              setForm(emptyMemberInput());
              setShowForm((v) => !v);
            }}
          >
            <MorphIcon icon={Plus} size={14} /> 新建账号
          </button>
        </div>
      </div>

      {error && <p className="admin-error">{error}</p>}
      {notice && <p className="admin-ok">{notice}</p>}

      {/* 初始密码只显示这一次 */}
      {newPassword && (
        <div className="admin-panel space-y-2">
          <div className="admin-panel__title">
            账号已创建 —— 初始密码只显示这一次
          </div>
          <p className="text-sm">
            登录名 <code className="admin-code">{newPassword.user}</code>
            ，初始密码 <code className="admin-code">{newPassword.pw}</code>
          </p>
          <p className="admin-muted text-xs">
            请立刻发给对方，并提醒 ta 登录后自行修改。数据库里只有 bcrypt 哈希，
            这个明文再也拿不到。
          </p>
          <div className="admin-actions">
            <button
              type="button"
              className="admin-btn admin-btn--ghost"
              onClick={() => setNewPassword(null)}
            >
              我已记下
            </button>
          </div>
        </div>
      )}

      {/* 新建表单 */}
      {showForm && (
        <div className="admin-panel space-y-3">
          <div className="admin-panel__title">新建账号</div>

          <div className="admin-filters">
            <label className="admin-field">
              <span>登录名 *</span>
              <input
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                placeholder="英文数字，用于登录"
                maxLength={50}
              />
            </label>

            <label className="admin-field">
              <span>显示名</span>
              <input
                value={form.display_name ?? ""}
                onChange={(e) =>
                  setForm({ ...form, display_name: e.target.value })
                }
                placeholder="文章上显示的署名"
                maxLength={60}
              />
            </label>

            <label className="admin-field admin-field--grow">
              <span>初始密码 *（至少 12 位）</span>
              <input
                type="text"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder="创建后只显示一次"
              />
            </label>

            <label className="admin-field">
              <span>每月上传上限（张）</span>
              <input
                type="number"
                min={0}
                value={form.upload_quota ?? 30}
                onChange={(e) =>
                  setForm({ ...form, upload_quota: Number(e.target.value) })
                }
              />
            </label>
          </div>

          <div className="admin-actions">
            <span className="admin-muted text-xs">
              角色默认「成员」：{ROLE_HINT.member}
            </span>
          </div>

          <div className="admin-actions">
            <button
              type="button"
              className="admin-btn"
              disabled={saving || !form.username || form.password.length < 12}
              onClick={() => void handleCreate()}
            >
              {saving ? "创建中…" : "创建成员"}
            </button>
            <button
              type="button"
              className="admin-btn admin-btn--ghost"
              onClick={() => setShowForm(false)}
            >
              取消
            </button>
          </div>
        </div>
      )}

      {/* 列表 */}
      <div className="admin-panel admin-panel--flush">
        {loading ? (
          <p className="admin-muted p-6">加载中…</p>
        ) : members.length === 0 ? (
          <p className="admin-muted p-6">
            还没有成员。点右上角「新建账号」加一个，对方就能登录后台发文了。
          </p>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>账号</th>
                <th>角色</th>
                <th>状态</th>
                <th>内容</th>
                <th>最近登录</th>
                <th style={{ width: 210 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id}>
                  <td>
                    <div className="admin-user">
                      <span className="admin-user__name">
                        {m.display_name || m.username}
                      </span>
                      <span className="admin-muted text-xs">
                        <code className="admin-code">{m.username}</code>
                      </span>
                    </div>
                  </td>
                  <td>
                    <span
                      className={
                        m.role === "admin"
                          ? "admin-badge admin-badge--approved"
                          : "admin-badge admin-badge--muted"
                      }
                    >
                      {m.role === "admin" ? "管理员" : "成员"}
                    </span>
                  </td>
                  <td>
                    <span
                      className={
                        m.status === "active"
                          ? "admin-badge admin-badge--approved"
                          : "admin-badge admin-badge--rejected"
                      }
                    >
                      {m.status === "active" ? "正常" : "已停用"}
                    </span>
                  </td>
                  <td className="admin-muted text-xs">{m.content_count} 篇/条</td>
                  <td className="admin-cell-time">
                    {m.last_login_at
                      ? new Date(m.last_login_at).toLocaleString("zh-CN")
                      : "从未"}
                  </td>
                  <td>
                    <div className="admin-actions">
                      {m.editable && (
                        <button
                          type="button"
                          className="admin-link"
                          onClick={() =>
                            void handleUpdate(
                              m,
                              m.role === "admin" ? "member" : "admin"
                            )
                          }
                        >
                          {m.role === "admin" ? "降为成员" : "升为管理员"}
                        </button>
                      )}
                      {m.editable && (
                        <button
                          type="button"
                          className={
                            m.status === "active"
                              ? "admin-link admin-link--warn"
                              : "admin-link"
                          }
                          onClick={() =>
                            void handleUpdate(
                              m,
                              undefined,
                              m.status === "active" ? "disabled" : "active"
                            )
                          }
                        >
                          {m.status === "active" ? "停用" : "启用"}
                        </button>
                      )}
                      <button
                        type="button"
                        className="admin-link"
                        onClick={() => void handleResetPassword(m)}
                      >
                        <MorphIcon icon={UserCog} size={13} /> 重置密码
                      </button>
                      {m.editable && (
                        <button
                          type="button"
                          className="admin-link admin-link--danger"
                          onClick={() => void handleDelete(m)}
                        >
                          <MorphIcon icon={Trash2} size={13} /> 删除
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="admin-muted text-xs">
        停用会立刻让该账号的登录失效（后端会删掉 ta 的所有会话）。「删除」是软删除：
        账号停用、记录与操作日志保留、内容不删。管理员至少保留一个，否则没人能再管理站点。
      </p>
    </div>
  );
}
