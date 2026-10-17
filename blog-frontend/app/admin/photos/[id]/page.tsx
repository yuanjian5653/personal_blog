"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api, API_BASE } from "@/lib/api";
import type { AlbumDetail, Photo } from "@/lib/types";
import { resolveImageUrl } from "@/lib/url";

export default function AdminAlbumEditPage() {
  const params = useParams();
  const router = useRouter();
  const id = Number(params.id);

  const [album, setAlbum] = useState<AlbumDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // 编辑表单
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [dateLabel, setDateLabel] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadAlbum = () => {
    api
      .get<AlbumDetail>(`/api/albums/${id}`)
      .then((d) => {
        setAlbum(d);
        setName(d.name);
        setDescription(d.description || "");
        setDateLabel(d.date_label || "");
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!id) return;
    loadAlbum();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // 保存基本信息
  const handleSave = async () => {
    setSaving(true);
    setMsg(null);
    try {
      await api.put(`/api/albums/${id}`, {
        name: name.trim(),
        description: description.trim() || null,
        date_label: dateLabel.trim() || null,
      });
      setMsg("已保存");
      loadAlbum();
    } catch (e) {
      setMsg(`保存失败：${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  // 上传图片
  const handleUpload = async (files: FileList) => {
    if (files.length === 0) return;
    setUploading(true);
    setMsg(null);
    try {
      const formData = new FormData();
      // FastAPI 用 list[UploadFile] 接收，字段名必须是 files
      // 多文件用同名 append 多次
      for (let i = 0; i < files.length; i++) {
        formData.append("files", files[i]);
      }

      await fetch(`${API_BASE}/api/albums/${id}/photos`, {
        method: "POST",
        body: formData,
        credentials: "include",
      }).then(async (res) => {
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.detail || `上传失败 (${res.status})`);
        }
      });

      setMsg(`上传成功 ${files.length} 张`);
      loadAlbum();
    } catch (e) {
      setMsg(`上传失败：${(e as Error).message}`);
    } finally {
      setUploading(false);
    }
  };

  // 删除单张照片
  const handleDeletePhoto = async (photo: Photo) => {
    if (!confirm(`确定删除这张图片？`)) return;
    try {
      await api.delete(`/api/albums/${id}/photos/${photo.id}`);
      loadAlbum();
    } catch (e) {
      alert(`删除失败：${(e as Error).message}`);
    }
  };

  if (loading) return <div>加载中...</div>;
  if (!album) return <div>图片组不存在</div>;

  return (
    <div className="space-y-6">
      {/* 顶部：返回 + 标题 */}
      <div className="flex items-center gap-4">
        <button
          onClick={() => router.push("/admin/photos")}
          className="text-sm hover:opacity-70"
          style={{ color: "var(--text-secondary)" }}
        >
          ← 返回列表
        </button>
        <h1 className="text-2xl font-bold">编辑图片组</h1>
      </div>

      {msg && (
        <div
          className="text-sm px-4 py-2 rounded-lg"
          style={{
            background: msg.includes("失败") ? "rgba(248,113,113,0.1)" : "rgba(34,197,94,0.1)",
            color: msg.includes("失败") ? "#f87171" : "#4ade80",
          }}
        >
          {msg}
        </div>
      )}

      {/* 基本信息表单 */}
      <section className="glass p-6 space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>
          基本信息
        </h2>

        <div>
          <label className="block text-xs mb-2" style={{ color: "var(--text-secondary)" }}>名称 *</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="admin-input"
          />
        </div>

        <div>
          <label className="block text-xs mb-2" style={{ color: "var(--text-secondary)" }}>描述</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="admin-textarea"
          />
        </div>

        <div>
          <label className="block text-xs mb-2" style={{ color: "var(--text-secondary)" }}>日期标签</label>
          <input
            type="text"
            value={dateLabel}
            onChange={(e) => setDateLabel(e.target.value)}
            placeholder="如 2026.04"
            className="admin-input"
          />
        </div>

        <div className="flex justify-end">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 rounded-lg text-sm disabled:opacity-50"
            style={{ background: "var(--adm-blue)", color: "#fff" }}
          >
            {saving ? "保存中..." : "保存"}
          </button>
        </div>
      </section>

      {/* 图片管理 */}
      <section className="glass p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>
            组内图片（{album.photos.length}）
          </h2>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="px-3 py-1.5 rounded-lg text-xs disabled:opacity-50"
            style={{ background: "var(--adm-blue)", color: "#fff" }}
          >
            {uploading ? "上传中..." : "+ 上传图片"}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) handleUpload(e.target.files);
              e.target.value = "";
            }}
          />
        </div>

        {album.photos.length === 0 ? (
          <div className="text-center py-12 text-sm" style={{ color: "var(--text-secondary)" }}>
            还没有图片，点右上角上传
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {album.photos.map((photo) => (
              <div key={photo.id} className="relative group aspect-square rounded-lg overflow-hidden bg-white/5">
                <img
                  src={resolveImageUrl(photo.file_path)}
                  alt={photo.title || ""}
                  className="w-full h-full object-cover"
                />
                {/* 悬浮删除按钮 */}
                <button
                  onClick={() => handleDeletePhoto(photo)}
                  className="absolute top-2 right-2 w-7 h-7 rounded-full flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{ background: "rgba(248,113,113,0.9)", color: "#fff" }}
                  title="删除"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}