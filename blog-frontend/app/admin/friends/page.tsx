"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { resolveImageUrl } from "@/lib/url";
import {
  createFriendLink,
  deleteFriendLink,
  fetchAllFriendLinks,
  updateFriendLink,
  uploadFriendCover,
  type FriendLink,
} from "@/lib/friendlinks";

/** 表单的初始值 */
const EMPTY = {
  name: "",
  url: "",
  category: "",
  description: "",
  cover: "",
  weight: 0,
  is_visible: true,
  sort_order: 0,
};

type FormState = typeof EMPTY;

export default function AdminFriendsPage() {
  const [links, setLinks] = useState<FriendLink[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // 正在编辑的 id；null 表示"新增"
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    fetchAllFriendLinks()
      .then(setLinks)
      .catch((e) => {
        setError(e instanceof Error ? e.message : "加载失败");
        setLinks([]);
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /** 权重区间，用于在表格里画相对长度条 */
  const weightRange = useMemo(() => {
    if (!links || links.length === 0) return { min: 0, max: 1 };
    const ws = links.map((l) => l.weight);
    return { min: Math.min(...ws), max: Math.max(...ws) };
  }, [links]);

  const resetForm = () => {
    setForm(EMPTY);
    setEditingId(null);
  };

  const startEdit = (link: FriendLink) => {
    setEditingId(link.id);
    setForm({
      name: link.name,
      url: link.url,
      category: link.category ?? "",
      description: link.description ?? "",
      cover: link.cover ?? "",
      weight: link.weight,
      is_visible: link.is_visible,
      sort_order: link.sort_order,
    });
    setError(null);
    setMsg(null);
    // 滚到表单，避免在长列表里"点了没反应"的错觉
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const payload = {
        name: form.name.trim(),
        url: form.url.trim(),
        category: form.category.trim() || null,
        description: form.description.trim() || null,
        cover: form.cover.trim() || null,
        weight: Number(form.weight) || 0,
        is_visible: form.is_visible,
        sort_order: Number(form.sort_order) || 0,
      };
      if (!payload.name) throw new Error("请填写名称");
      if (!payload.url) throw new Error("请填写网址");

      if (editingId === null) {
        await createFriendLink(payload);
        setMsg("已添加");
      } else {
        await updateFriendLink(editingId, payload);
        setMsg("已保存");
      }
      resetForm();
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (link: FriendLink) => {
    if (!window.confirm(`确定删除友链「${link.name}」？`)) return;
    setBusy(true);
    setError(null);
    try {
      await deleteFriendLink(link.id);
      if (editingId === link.id) resetForm();
      setMsg("已删除");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败");
    } finally {
      setBusy(false);
    }
  };

  /** 快速切换显示/隐藏（不必进表单） */
  const toggleVisible = async (link: FriendLink) => {
    try {
      await updateFriendLink(link.id, { is_visible: !link.is_visible });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败");
    }
  };

  const pickCover = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const path = await uploadFriendCover(file);
      setForm((f) => ({ ...f, cover: path }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "上传失败");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-4 max-w-5xl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold">友链管理</h1>
        {links && <span className="admin-muted text-xs">共 {links.length} 条</span>}
      </div>

      {/* ---------- 表单 ---------- */}
      <form className="admin-panel space-y-3" onSubmit={submit}>
        <div className="admin-panel__title">
          {editingId === null ? "添加友链" : `编辑友链 #${editingId}`}
        </div>

        <div className="admin-filters">
          <label className="admin-field">
            <span>名称 *</span>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="例如：某某的博客"
              maxLength={100}
            />
          </label>

          <label className="admin-field admin-field--grow">
            <span>网址 *</span>
            <input
              value={form.url}
              onChange={(e) => setForm({ ...form, url: e.target.value })}
              placeholder="example.com（不写 https:// 会自动补）"
              maxLength={500}
            />
          </label>

          <label className="admin-field">
            <span>类型</span>
            <input
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              placeholder="技术 / 设计 / 生活"
              maxLength={50}
            />
          </label>
        </div>

        <div className="admin-filters">
          <label className="admin-field">
            <span>权重（越大越突出）</span>
            <input
              type="number"
              value={form.weight}
              onChange={(e) => setForm({ ...form, weight: Number(e.target.value) })}
            />
          </label>

          <label className="admin-field">
            <span>排序（同权重时越小越前）</span>
            <input
              type="number"
              value={form.sort_order}
              onChange={(e) =>
                setForm({ ...form, sort_order: Number(e.target.value) })
              }
            />
          </label>

          <label className="admin-field">
            <span>显示</span>
            <select
              value={form.is_visible ? "1" : "0"}
              onChange={(e) =>
                setForm({ ...form, is_visible: e.target.value === "1" })
              }
            >
              <option value="1">显示</option>
              <option value="0">隐藏</option>
            </select>
          </label>
        </div>

        <label className="admin-field admin-field--grow">
          <span>简介</span>
          <input
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="一句话介绍这个站点"
            maxLength={500}
          />
        </label>

        {/* 封面 */}
        <div className="admin-field admin-field--grow">
          <span>封面</span>
          <div className="fl-cover-row">
            {form.cover ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={resolveImageUrl(form.cover)}
                alt=""
                className="fl-cover-preview"
              />
            ) : (
              <span className="fl-cover-preview fl-cover-preview--empty">无</span>
            )}
            <input
              value={form.cover}
              onChange={(e) => setForm({ ...form, cover: e.target.value })}
              placeholder="也可以直接粘贴图片地址"
              className="fl-cover-input"
            />
            <button
              type="button"
              className="admin-btn admin-btn--ghost"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
            >
              {uploading ? "上传中…" : "上传"}
            </button>
            {form.cover && (
              <button
                type="button"
                className="admin-link admin-link--danger"
                onClick={() => setForm({ ...form, cover: "" })}
              >
                清除
              </button>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) pickCover(f);
              e.target.value = "";
            }}
          />
        </div>

        {error && <p className="admin-error">{error}</p>}
        {msg && <p className="admin-ok">{msg}</p>}

        <div className="flex items-center gap-3">
          <button type="submit" className="admin-btn" disabled={busy}>
            {busy ? "保存中…" : editingId === null ? "添加" : "保存修改"}
          </button>
          {editingId !== null && (
            <button
              type="button"
              className="admin-btn admin-btn--ghost"
              onClick={resetForm}
            >
              取消编辑
            </button>
          )}
        </div>
      </form>

      {/* ---------- 列表 ---------- */}
      <div className="admin-panel admin-panel--flush">
        {links === null ? (
          <p className="admin-muted p-6">加载中…</p>
        ) : links.length === 0 ? (
          <p className="admin-muted p-6">还没有友链，用上面的表单添加一条</p>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>封面</th>
                <th>名称 / 网址</th>
                <th>类型</th>
                <th>权重</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {links.map((link) => (
                <tr key={link.id} style={link.is_visible ? undefined : { opacity: 0.55 }}>
                  <td>
                    {link.cover ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={resolveImageUrl(link.cover)}
                        alt=""
                        className="admin-avatar"
                      />
                    ) : (
                      <span className="admin-avatar admin-avatar--fallback">
                        {link.name[0]?.toUpperCase()}
                      </span>
                    )}
                  </td>
                  <td>
                    <div className="admin-user">
                      <span className="admin-user__name">{link.name}</span>
                    </div>
                    <a
                      className="admin-muted admin-cell-sub fl-url"
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {link.url}
                    </a>
                    {link.description && (
                      <div className="admin-muted admin-cell-sub" title={link.description}>
                        {link.description}
                      </div>
                    )}
                  </td>
                  <td>
                    {link.category ? (
                      <span className="admin-tag">{link.category}</span>
                    ) : (
                      <span className="admin-muted">-</span>
                    )}
                  </td>
                  <td>
                    {/* 权重条：让"相对大小"在表格里也能一眼看出 */}
                    <div className="fl-weight">
                      <span className="fl-weight__num">{link.weight}</span>
                      <span className="fl-weight__bar">
                        <span
                          className="fl-weight__fill"
                          style={{ width: `${weightPercent(link.weight, weightRange)}%` }}
                        />
                      </span>
                    </div>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="admin-link"
                      onClick={() => toggleVisible(link)}
                      title="点击切换显示 / 隐藏"
                    >
                      {link.is_visible ? "显示中" : "已隐藏"}
                    </button>
                  </td>
                  <td>
                    <div className="admin-actions">
                      <button
                        type="button"
                        className="admin-link"
                        onClick={() => startEdit(link)}
                      >
                        编辑
                      </button>
                      <button
                        type="button"
                        className="admin-link admin-link--danger"
                        onClick={() => remove(link)}
                      >
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/** 把权重换算成 0..100 的条长（全部同权重时给满格，避免看起来都是空的） */
function weightPercent(
  weight: number,
  range: { min: number; max: number }
): number {
  if (range.max === range.min) return 100;
  const t = (weight - range.min) / (range.max - range.min);
  // 留一点最小可见长度，负权重也能看出有值
  return 8 + t * 92;
}
