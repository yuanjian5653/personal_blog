"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { LifePost } from "@/lib/types";
import { formatDateTime } from "@/lib/format";
import { resolveImageUrl } from "@/lib/url";
import ImageUploader from "@/components/admin/ImageUploader";

interface EditData {
  id: number | null;
  content: string;
  imagesText: string;      // 每行一个路径
  location: string;
  created_at: string;      // 可选，用于编辑已有动态的时间
}

const EMPTY: EditData = {
  id: null,
  content: "",
  imagesText: "",
  location: "",
  created_at: "",
};

export default function AdminLifePage() {
  // null = 尚未加载完；loading 由它派生，避免在 effect 里同步 setState
  const [posts, setPosts] = useState<LifePost[] | null>(null);
  const loading = posts === null;
  const [editing, setEditing] = useState<EditData | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = () => {
    api
      .get<LifePost[]>("/api/life")
      .then(setPosts)
      .catch(() => setPosts([]));
  };

  useEffect(() => {
    load();
  }, []);

  // 打开新建
  const openCreate = () => {
    setEditing({ ...EMPTY });
    setMsg(null);
  };

  // 打开编辑
  const openEdit = (p: LifePost) => {
    setEditing({
      id: p.id,
      content: p.content,
      imagesText: p.images.join("\n"),
      location: p.location || "",
      created_at: p.created_at,
    });
    setMsg(null);
  };

  // 保存
  const handleSave = async () => {
    if (!editing) return;
    if (!editing.content.trim() && !editing.imagesText.trim()) {
      setMsg("内容和图片至少填一个");
      return;
    }
    setSaving(true);
    setMsg(null);
    try {
      const images = editing.imagesText
        .split("\n")
        .map((x) => x.trim())
        .filter(Boolean);

      const payload = {
        content: editing.content,
        images,
        location: editing.location.trim() || null,
      };

      if (editing.id) {
        await api.put(`/api/life/${editing.id}`, payload);
      } else {
        await api.post("/api/life", payload);
      }
      setEditing(null);
      load();
    } catch (e) {
      setMsg(`保存失败：${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  // 删除
  const handleDelete = async (p: LifePost) => {
    const preview = p.content.slice(0, 20) || "(无内容)";
    if (!confirm(`确定删除这条动态？\n\n${preview}...`)) return;
    try {
      await api.delete(`/api/life/${p.id}`);
      setPosts((prev) => (prev ?? []).filter((x) => x.id !== p.id));
    } catch (e) {
      alert(`删除失败：${(e as Error).message}`);
    }
  };

  return (
    <div className="space-y-6">
      {/* 头部 */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">生活动态</h1>
        <button
          onClick={openCreate}
          className="px-4 py-2 rounded-lg text-sm"
          style={{ background: "var(--accent)", color: "#fff" }}
        >
          + 新建动态
        </button>
      </div>

      {msg && (
        <div
          className="text-sm px-4 py-2 rounded-lg"
          style={{
            background: msg.includes("失败")
              ? "rgba(248,113,113,0.1)"
              : "rgba(34,197,94,0.1)",
            color: msg.includes("失败") ? "#f87171" : "#4ade80",
          }}
        >
          {msg}
        </div>
      )}

      {/* 列表 */}
      {loading ? (
        <div style={{ color: "var(--text-secondary)" }}>加载中...</div>
      ) : posts.length === 0 ? (
        <div
          className="glass p-16 text-center text-sm"
          style={{ color: "var(--text-secondary)" }}
        >
          还没有动态
        </div>
      ) : (
        <div className="space-y-3">
          {posts.map((p) => (
            <div
              key={p.id}
              className="glass p-4 hover:bg-white/5 transition-colors group"
            >
              <div className="flex items-start justify-between gap-3 mb-2">
                <div
                  className="text-xs"
                  style={{ color: "var(--text-secondary)" }}
                >
                  {formatDateTime(p.created_at)}
                  {p.location && ` · ${p.location}`}
                </div>
                <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => openEdit(p)}
                    className="text-xs px-3 py-1.5 rounded hover:bg-white/10"
                  >
                    编辑
                  </button>
                  <button
                    onClick={() => handleDelete(p)}
                    className="text-xs px-3 py-1.5 rounded"
                    style={{ color: "#f87171" }}
                  >
                    删除
                  </button>
                </div>
              </div>

              {p.content && (
                <p
                  className="text-sm line-clamp-3 mb-2"
                  style={{ color: "var(--text-primary)" }}
                >
                  {p.content}
                </p>
              )}

              {p.images.length > 0 && (
                <div className="flex gap-2 flex-wrap">
                  {p.images.slice(0, 6).map((img, i) => (
                    <img
                      key={i}
                      src={resolveImageUrl(img)}
                      alt=""
                      className="w-16 h-16 rounded object-cover"
                      onError={(e) =>
                        ((e.target as HTMLImageElement).style.display = "none")
                      }
                    />
                  ))}
                  {p.images.length > 6 && (
                    <div
                      className="w-16 h-16 rounded flex items-center justify-center text-xs"
                      style={{
                        background: "var(--adm-tag-bg)",
                        color: "var(--text-secondary)",
                      }}
                    >
                      +{p.images.length - 6}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 编辑弹窗 */}
      {editing && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-6"
          style={{ background: "rgba(0,0,0,0.6)" }}
          onClick={() => setEditing(null)}
        >
          <div
            className="glass p-6 w-full max-w-2xl space-y-4 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold">
              {editing.id ? "编辑动态" : "新建动态"}
            </h2>

            {/* 内容 */}
            <div>
              <label
                className="block text-xs mb-2"
                style={{ color: "var(--text-secondary)" }}
              >
                内容
              </label>
              <textarea
                value={editing.content}
                onChange={(e) =>
                  setEditing({ ...editing, content: e.target.value })
                }
                rows={5}
                placeholder="说点什么……"
                className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 focus:border-[var(--accent)] outline-none text-sm resize-y"
              />
            </div>

            {/* 图片 */}
            <div>
              <ImageUploader
                value={editing.imagesText
                  .split("\n")
                  .map((x) => x.trim())
                  .filter(Boolean)}
                onChange={(imgs) =>
                  setEditing({ ...editing, imagesText: imgs.join("\n") })
                }
                multiple
                max={9}
                showInput
                label="图片（最多 9 张）"
              />
            </div>

            {/* 位置 */}
            <div>
              <label
                className="block text-xs mb-2"
                style={{ color: "var(--text-secondary)" }}
              >
                位置（可选）
              </label>
              <input
                type="text"
                value={editing.location}
                onChange={(e) =>
                  setEditing({ ...editing, location: e.target.value })
                }
                placeholder="南昌市 高新区"
                className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 focus:border-[var(--accent)] outline-none text-sm"
              />
            </div>

            {/* 操作 */}
            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => setEditing(null)}
                className="px-4 py-2 rounded-lg text-sm border border-white/10 hover:bg-white/5"
              >
                取消
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 rounded-lg text-sm disabled:opacity-50"
                style={{ background: "var(--accent)", color: "#fff" }}
              >
                {saving ? "保存中..." : "保存"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}