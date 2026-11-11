"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import ReviewStatusBadge from "@/components/admin/ReviewStatusBadge";
import { api } from "@/lib/api";
import { resolveImageUrl } from "@/lib/url";
import {
  createFriendLink,
  updateFriendLink,
  uploadFriendCover,
  type FriendLink,
} from "@/lib/friendlinks";
import { saveMessage } from "@/lib/review";

/**
 * 友链的编辑器（独立页面）
 *
 * 以前是列表页顶部的内联表单。改成独立页面后，
 * 「编辑某一条」在文章 / 说说 / 动态 / 图片组 / 友链之间完全一致。
 *
 * id 为 null 表示新建。
 */
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

export default function FriendEditor({ id }: { id: number | null }) {
  const router = useRouter();

  const [form, setForm] = useState({ ...EMPTY });
  const [review, setReview] = useState<{
    status?: string;
    note?: string | null;
  }>({});
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [loadedId, setLoadedId] = useState<number | null>(null);
  const loading = id !== null && loadedId !== id;
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (id === null) return;
    let cancelled = false;
    // 没有"单条友链"的接口，从后台列表里挑出来即可
    // （后台列表对成员只返回自己的，所以拿到的就是 ta 能编辑的那条）
    api
      .get<FriendLink[]>("/api/friend-links/all")
      .then((rows) => {
        if (cancelled) return;
        const link = rows.find((r) => r.id === id);
        if (!link) {
          setError("这条友链不存在，或不属于你");
          return;
        }
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
        setReview({ status: link.review_status, note: link.review_note });
      })
      .catch(() => setError("加载失败"))
      .finally(() => {
        if (!cancelled) setLoadedId(id);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const pickCover = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const url = await uploadFriendCover(file);
      setForm((f) => ({ ...f, cover: url }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "上传失败");
    } finally {
      setUploading(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMsg(null);
    setBusy(true);
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

      if (id === null) {
        const created = await createFriendLink(payload);
        router.replace(`/admin/friends/${created.id}`);
        return;
      }
      const saved = await updateFriendLink(id, payload);
      setReview({ status: saved.review_status, note: saved.review_note });
      setMsg(saveMessage(saved.review_status));
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <div className="admin-muted p-6">加载中…</div>;
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="admin-btn admin-btn--ghost"
            onClick={() => router.push("/admin/friends")}
          >
            ← 返回列表
          </button>
          <h1 className="text-2xl font-bold">
            {id ? `编辑友链 #${id}` : "添加友链"}
          </h1>
        </div>
        {review.status && (
          <div className="flex items-center gap-2">
            <span className="admin-muted text-xs">审核状态：</span>
            <ReviewStatusBadge status={review.status} note={review.note} />
          </div>
        )}
      </div>

      <div className="admin-panel space-y-3">
        <div className="admin-panel__title">基本信息</div>

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

        <label className="admin-field admin-field--grow">
          <span>简介</span>
          <input
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="一句话介绍这个站点"
            maxLength={500}
          />
        </label>
      </div>

      <div className="admin-panel space-y-3">
        <div className="admin-panel__title">排序与显示</div>

        <div className="admin-filters">
          <label className="admin-field">
            <span>权重（越大越突出）</span>
            <input
              type="number"
              value={form.weight}
              onChange={(e) =>
                setForm({ ...form, weight: Number(e.target.value) })
              }
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

          {/* 后台没有 select 样式，用两个按钮表示显隐 */}
          <div className="admin-field">
            <span>显示</span>
            <div className="admin-actions">
              <button
                type="button"
                className={form.is_visible ? "admin-btn" : "admin-btn admin-btn--ghost"}
                onClick={() => setForm({ ...form, is_visible: true })}
              >
                显示
              </button>
              <button
                type="button"
                className={!form.is_visible ? "admin-btn" : "admin-btn admin-btn--ghost"}
                onClick={() => setForm({ ...form, is_visible: false })}
              >
                隐藏
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="admin-panel space-y-3">
        <div className="admin-panel__title">封面</div>
        <div className="admin-field admin-field--grow">
          <div className="fl-cover-row">
            {form.cover ? (
              <img decoding="async"
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
              if (f) void pickCover(f);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      {error && <p className="admin-error">{error}</p>}
      {msg && <p className="admin-ok">{msg}</p>}

      <div className="admin-actions">
        <button type="submit" className="admin-btn" disabled={busy}>
          {busy ? "保存中…" : "保存"}
        </button>
        <button
          type="button"
          className="admin-btn admin-btn--ghost"
          onClick={() => router.push("/admin/friends")}
        >
          取消
        </button>
      </div>
    </form>
  );
}
