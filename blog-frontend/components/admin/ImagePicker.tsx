"use client";

import { useEffect, useRef, useState } from "react";
import { api, withApiBase } from "@/lib/api";

interface ImageItem {
  name: string;
  url: string;
  size: number;
}

interface Props {
  /** 当前选中的图片 URL（相对或绝对） */
  value: string;
  /** 选中或上传成功后的回调 */
  onChange: (url: string) => void;
  /** 是否允许手动输入外部 URL */
  allowExternal?: boolean;
}

export default function ImagePicker({ value, onChange, allowExternal = true }: Props) {
  const [images, setImages] = useState<ImageItem[]>([]);
  const [open, setOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 打开面板时才加载图片列表
  useEffect(() => {
    if (!open) return;
    api
      .get<{ images: ImageItem[] }>("/api/site-config/images")
      .then((d) => setImages(d.images))
      .catch((e) => setError(e.message));
  }, [open]);

  // 上传新图
  const handleUpload = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await api.post<{ url: string }>(
        "/api/site-config/images/upload",
        formData
      );
      // 上传后立即选中
      onChange(res.url);
      // 刷新列表
      const d = await api.get<{ images: ImageItem[] }>("/api/site-config/images");
      setImages(d.images);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  // 把相对路径转成可访问的完整 URL
  const toFullUrl = (url: string) => withApiBase(url);

  return (
    <div className="space-y-3">
      {/* 当前选中预览 */}
      <div className="flex items-center gap-3">
        {value ? (
          <img
            src={toFullUrl(value)}
            alt="当前背景"
            className="w-24 h-16 object-cover rounded-lg border border-white/10"
          />
        ) : (
          <div className="w-24 h-16 rounded-lg border border-white/10 flex items-center justify-center text-xs" style={{ color: "var(--text-secondary)" }}>
            未选择
          </div>
        )}

        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="admin-btn admin-btn--ghost"
          >
            {open ? "收起图库" : "从图库选择"}
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="admin-btn admin-btn--ghost"
          >
            {uploading ? "上传中..." : "上传新图"}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleUpload(f);
              // 清空以便重复上传同一文件
              e.target.value = "";
            }}
          />
        </div>
      </div>

      {/* 手动输入外部 URL */}
      {allowExternal && (
        <input
          type="text"
          value={value}
          placeholder="或直接填外部图片 URL：https://..."
          onChange={(e) => onChange(e.target.value)}
          className="admin-input"
        />
      )}

      {error && (
        <div className="text-xs px-3 py-2 rounded" style={{ color: "#f87171", background: "rgba(248,113,113,0.1)" }}>
          {error}
        </div>
      )}

      {/* 图库面板 */}
      {open && (
        <div className="glass p-4 max-h-80 overflow-y-auto">
          {images.length === 0 ? (
            <div className="text-xs text-center py-6" style={{ color: "var(--text-secondary)" }}>
              图库还是空的，点「上传新图」添加
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-3">
              {images.map((img) => {
                const selected = value === img.url;
                return (
                  <button
                    key={img.name}
                    type="button"
                    onClick={() => {
                      onChange(img.url);
                      setOpen(false);
                    }}
                    className="relative aspect-video rounded-lg overflow-hidden border-2 transition-all"
                    style={{
                      borderColor: selected ? "var(--adm-blue)" : "transparent",
                    }}
                  >
                    <img
                      src={withApiBase(img.url)}
                      alt={img.name}
                      className="w-full h-full object-cover"
                    />
                    {selected && (
                      <div
                        className="absolute top-1 right-1 w-5 h-5 rounded-full flex items-center justify-center text-xs text-white"
                        style={{ background: "var(--adm-blue)" }}
                      >
                        ✓
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}