"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  deleteProject,
  fetchAllProjects,
  fetchProjectConfig,
  languageColor,
  relativeFrom,
  syncProjects,
  updateProject,
  type Project,
  type ProjectConfig,
} from "@/lib/projects";

export default function AdminProjectsPage() {
  const [config, setConfig] = useState<ProjectConfig | null>(null);
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  /** 正在编辑自定义文案的项目 id */
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftDesc, setDraftDesc] = useState("");

  const load = useCallback(() => {
    fetchAllProjects()
      .then(setProjects)
      .catch((e) => {
        setError(e instanceof Error ? e.message : "加载失败");
        setProjects([]);
      });
    fetchProjectConfig()
      .then(setConfig)
      .catch(() => setConfig(null));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /** 统计：展示中 / 已隐藏，方便一眼看出配置状态 */
  const stats = useMemo(() => {
    if (!projects) return { total: 0, visible: 0, pinned: 0 };
    return {
      total: projects.length,
      visible: projects.filter((p) => p.is_visible).length,
      pinned: projects.filter((p) => p.is_pinned).length,
    };
  }, [projects]);

  const doSync = async () => {
    setSyncing(true);
    setError(null);
    setMsg(null);
    try {
      const r = await syncProjects();
      setMsg(
        `同步完成：共 ${r.total} 个仓库，新增 ${r.created}，更新 ${r.updated}`
      );
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "同步失败");
    } finally {
      setSyncing(false);
    }
  };

  const toggle = async (p: Project, field: "is_visible" | "is_pinned") => {
    setBusyId(p.id);
    setError(null);
    try {
      await updateProject(p.id, { [field]: !p[field] });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusyId(null);
    }
  };

  const startEdit = (p: Project) => {
    setEditingId(p.id);
    setDraftTitle(p.title);
    setDraftDesc(p.summary ?? "");
    setError(null);
    setMsg(null);
  };

  const saveEdit = async () => {
    if (editingId === null) return;
    setBusyId(editingId);
    setError(null);
    try {
      await updateProject(editingId, {
        custom_title: draftTitle.trim() || null,
        custom_description: draftDesc.trim() || null,
      });
      setEditingId(null);
      setMsg("已保存");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (p: Project) => {
    if (
      !window.confirm(
        `确定从站内移除「${p.title}」？\n\n注意：它下次同步会重新出现。` +
          `想隐藏请用「不显示」。`
      )
    )
      return;
    setBusyId(p.id);
    setError(null);
    try {
      await deleteProject(p.id);
      setMsg("已移除");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除失败");
    } finally {
      setBusyId(null);
    }
  };

  const noUsername = config !== null && !config.username;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold">项目管理</h1>
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="admin-btn admin-btn--ghost"
            onClick={load}
            disabled={syncing}
          >
            刷新
          </button>
          <button
            type="button"
            className="admin-btn"
            onClick={doSync}
            disabled={syncing || noUsername}
            title={
              noUsername
                ? "还没有配置 GITHUB_USERNAME"
                : "从 GitHub 拉取仓库并同步（保留你在后台做的设置）"
            }
          >
            {syncing ? "同步中…" : "同步 GitHub"}
          </button>
        </div>
      </div>

      {/* 配置状态：让"为什么不显示项目"一眼可见 */}
      <div className="admin-panel">
        <div className="admin-panel__title">GitHub 配置</div>
        <div className="admin-proj-config">
          <span>
            账号：
            {config === null ? (
              "读取中…"
            ) : config.username ? (
              <a
                className="admin-link"
                href={`https://github.com/${config.username}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {config.username}
              </a>
            ) : (
              <strong>未配置</strong>
            )}
          </span>
          <span>
            API Token：
            {config?.has_token ? "已配置（额度 5000/小时）" : "未配置（额度 60/小时）"}
          </span>
          {config?.languages && <span>语言过滤：{config.languages}</span>}
        </div>
        {noUsername && (
          <p className="admin-muted text-xs mt-2">
            在 <code>blog-backend/.env</code> 里设置{" "}
            <code>GITHUB_USERNAME=你的用户名</code> 并重启后端，然后点「同步
            GitHub」。匿名接口每小时只有 60 次，建议顺便填{" "}
            <code>GITHUB_TOKEN</code>。
          </p>
        )}
        {projects && projects.length > 0 && (
          <p className="admin-muted text-xs mt-2">
            共 {stats.total} 个仓库 · 展示中 {stats.visible} · 置顶 {stats.pinned}
          </p>
        )}
      </div>

      {error && <p className="admin-error">{error}</p>}
      {msg && <p className="admin-ok">{msg}</p>}

      {/* 自定义文案编辑 */}
      {editingId !== null && (
        <div className="admin-panel space-y-3">
          <div className="admin-panel__title">编辑展示文案</div>
          <label className="admin-field admin-field--grow">
            <span>标题（留空则用仓库名）</span>
            <input
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              maxLength={200}
            />
          </label>
          <label className="admin-field admin-field--grow">
            <span>简介（留空则用 GitHub 上的描述）</span>
            <input
              value={draftDesc}
              onChange={(e) => setDraftDesc(e.target.value)}
              maxLength={1000}
            />
          </label>
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="admin-btn"
              onClick={saveEdit}
              disabled={busyId === editingId}
            >
              保存
            </button>
            <button
              type="button"
              className="admin-btn admin-btn--ghost"
              onClick={() => setEditingId(null)}
            >
              取消
            </button>
          </div>
        </div>
      )}

      {/* 列表 */}
      <div className="admin-panel admin-panel--flush">
        {projects === null ? (
          <p className="admin-muted p-6">加载中…</p>
        ) : projects.length === 0 ? (
          <p className="admin-muted p-6">
            还没有项目。{noUsername ? "先配置 GITHUB_USERNAME，" : ""}
            然后点右上角「同步 GitHub」。
          </p>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>仓库</th>
                <th>语言</th>
                <th>Star</th>
                <th>最近推送</th>
                <th>展示</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr
                  key={p.id}
                  style={p.is_visible ? undefined : { opacity: 0.55 }}
                >
                  <td>
                    <div className="admin-user">
                      <span className="admin-user__name">{p.title}</span>
                      {p.is_pinned && (
                        <span className="admin-tag" title="已置顶">
                          置顶
                        </span>
                      )}
                    </div>
                    <a
                      className="admin-muted admin-cell-sub admin-proj-url"
                      href={p.html_url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {p.full_name}
                    </a>
                    {p.summary && (
                      <div
                        className="admin-muted admin-cell-sub admin-proj-desc"
                        title={p.summary}
                      >
                        {p.summary}
                      </div>
                    )}
                  </td>
                  <td>
                    {p.language ? (
                      <span className="admin-proj-lang">
                        <i
                          className="admin-proj-dot"
                          style={{ background: languageColor(p.language) }}
                        />
                        {p.language}
                      </span>
                    ) : (
                      <span className="admin-muted">-</span>
                    )}
                  </td>
                  <td className="admin-muted">★ {p.stars}</td>
                  <td className="admin-muted admin-cell-time">
                    {relativeFrom(p.pushed_at) || "-"}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="admin-link"
                      disabled={busyId === p.id}
                      onClick={() => toggle(p, "is_visible")}
                      title="点击切换显示 / 隐藏"
                    >
                      {p.is_visible ? "显示中" : "已隐藏"}
                    </button>
                  </td>
                  <td>
                    <div className="admin-actions">
                      <button
                        type="button"
                        className="admin-link"
                        disabled={busyId === p.id}
                        onClick={() => toggle(p, "is_pinned")}
                      >
                        {p.is_pinned ? "取消置顶" : "置顶"}
                      </button>
                      <button
                        type="button"
                        className="admin-link"
                        onClick={() => startEdit(p)}
                      >
                        文案
                      </button>
                      <button
                        type="button"
                        className="admin-link admin-link--danger"
                        disabled={busyId === p.id}
                        onClick={() => remove(p)}
                      >
                        移除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="admin-muted text-xs">
        说明：同步只会更新 GitHub 侧的字段（描述 / 语言 / Star / 推送时间），
        你在后台设的<strong>展示开关、置顶、自定义文案都会保留</strong>。
      </p>
    </div>
  );
}
