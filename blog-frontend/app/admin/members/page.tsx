"use client";

import { useCallback, useEffect, useState } from "react";
import { MorphIcon } from "morphicons/react";
import { Plus, RefreshCw, Trash2, UserCog } from "lucide";

import {
  Member,
  MemberCreateInput,
  MemberRole,
  MemberStatus,
  ROLE_HINT,
  ROLE_LABEL,
  STATUS_LABEL,
  createMember,
  deleteMember,
  emptyMemberInput,
  fetchMembers,
  resetMemberPassword,
  updateMember,
} from "@/lib/members";

/**
 * 成员管理（仅管理员可见/可用）。
 *
 * 后端的三条保护规则在这里也会撞到，所以要把错误信息原样显示出来，
 * 而不是笼统提示"操作失败" —— 比如"这是最后一个启用中的管理员"。
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
    setLoading(true);
    setError("");
    try {
      setMembers(await fetchMembers());
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  // 首次加载：异步结果在回调里 setState（effect 体内不能同步 setState，
  // 否则触发 project 的 react-hooks/set-state-in-effect 规则）
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

  const handleUpdate = async (
    m: Member,
    patch: { role?: MemberRole; status?: MemberStatus }
  ) => {
    setError("");
    try {
      await updateMember(m.id, patch);
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
    <div className="admin-page">
      <header className="admin-page__head">
        <div>
          <h1 className="admin-page__title">成员管理</h1>
          <p className="admin-muted">
            管理员拥有全部权限；成员只能管理自己的内容。
          </p>
        </div>
        <div className="admin-actions">
          <button
            type="button"
            className="admin-btn admin-btn--ghost"
            onClick={() => void load()}
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
      </header>

      {error && <p className="admin-error">{error}</p>}
      {notice && <p className="admin-ok">{notice}</p>}

      {/* 初始密码只显示这一次 */}
      {newPassword && (
        <div className="admin-panel">
          <p className="admin-panel__title">账号已创建 —— 初始密码只显示这一次</p>
          <p className="admin-muted">
            登录名 <code className="admin-code">{newPassword.user}</code>
            ，初始密码{" "}
            <code className="admin-code">{newPassword.pw}</code>
          </p>
          <p className="admin-muted">
            请立刻把它发给对方，并提醒 ta 登录后自行修改。
          </p>
          <button
            type="button"
            className="admin-btn admin-btn--ghost"
            onClick={() => setNewPassword(null)}
          >
            我已记下
          </button>
        </div>
      )}

      {showForm && (
        <div className="admin-panel">
          <p className="admin-panel__title">新建账号</p>
          <div className="admin-filters">
            <label className="admin-field">
              登录名
              <input
                className="admin-input"
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                placeholder="英文数字，用于登录"
              />
            </label>
            <label className="admin-field">
              显示名
              <input
                className="admin-input"
                value={form.display_name ?? ""}
                onChange={(e) =>
                  setForm({ ...form, display_name: e.target.value })
                }
                placeholder="文章上显示的署名"
              />
            </label>
            <label className="admin-field">
              初始密码（至少 12 位）
              <input
                className="admin-input"
                type="text"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder="创建后只显示一次"
              />
            </label>
            <label className="admin-field">
              角色
              <select
                className="admin-input"
                value={form.role}
                onChange={(e) =>
                  setForm({ ...form, role: e.target.value as MemberRole })
                }
              >
                <option value="member">成员</option>
                <option value="admin">管理员</option>
              </select>
            </label>
            <label className="admin-field">
              每月上传上限（张）
              <input
                className="admin-input"
                type="number"
                min={0}
                value={form.upload_quota ?? 30}
                onChange={(e) =>
                  setForm({ ...form, upload_quota: Number(e.target.value) })
                }
              />
            </label>
          </div>
          <p className="admin-muted">{ROLE_HINT[form.role]}</p>
          <div className="admin-actions">
            <button
              type="button"
              className="admin-btn"
              disabled={saving || !form.username || form.password.length < 12}
              onClick={() => void handleCreate()}
            >
              {saving ? "创建中…" : "创建"}
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

      {loading ? (
        <p className="admin-muted">加载中…</p>
      ) : (
        <table className="admin-table">
          <thead>
            <tr>
              <th>账号</th>
              <th>角色</th>
              <th>状态</th>
              <th>内容</th>
              <th>最近登录</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id}>
                <td>
                  <div className="admin-cell-content">
                    {m.display_name || m.username}
                  </div>
                  <div className="admin-cell-sub">
                    <code className="admin-code">{m.username}</code>
                  </div>
                </td>
                <td>
                  <select
                    className="admin-input admin-input--compact"
                    value={m.role}
                    disabled={!m.editable}
                    onChange={(e) =>
                      void handleUpdate(m, {
                        role: e.target.value as MemberRole,
                      })
                    }
                  >
                    <option value="admin">管理员</option>
                    <option value="member">成员</option>
                  </select>
                </td>
                <td>
                  <select
                    className="admin-input admin-input--compact"
                    value={m.status}
                    disabled={!m.editable}
                    onChange={(e) =>
                      void handleUpdate(m, {
                        status: e.target.value as MemberStatus,
                      })
                    }
                  >
                    <option value="active">{STATUS_LABEL.active}</option>
                    <option value="disabled">{STATUS_LABEL.disabled}</option>
                  </select>
                </td>
                <td className="admin-cell-sub">{m.content_count} 篇/条</td>
                <td className="admin-cell-time">
                  {m.last_login_at
                    ? new Date(m.last_login_at).toLocaleString("zh-CN")
                    : "从未"}
                </td>
                <td>
                  <div className="admin-actions">
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
                        <MorphIcon icon={Trash2} size={13} /> 停用
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="admin-muted">
        提示：停用会立刻让该账号的登录失效（后端会删掉 ta 的所有会话）。
        {ROLE_LABEL.admin} 至少保留一个，否则没人能再管理站点。
      </p>
    </div>
  );
}
