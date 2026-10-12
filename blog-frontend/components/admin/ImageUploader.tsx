"use client";

import { useRef, useState } from "react";
import { API_BASE } from "@/lib/api";
import { resolveImageUrl } from "@/lib/url";

interface ImageUploaderProps {
  /** 已上传的图片（相对路径或完整 URL） */
  value: string[];
  onChange: (value: string[]) => void;
  /** 是否多图 */
  multiple?: boolean;
  /** 多图时最多几张 */
  max?: number;
  /** 是否显示手动输入 URL 的输入框 */
  showInput?: boolean;
  /** 上方标签文字 */
  label?: string;
}

function toUrl(path: string): string {
  return resolveImageUrl(path);
}

export default function ImageUploader({
  value,
  onChange,
  multiple = false,
  max = 9,
  showInput = false,
  label,
}: ImageUploaderProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [manualInput, setManualInput] = useState("");

  const canAdd = multiple ? value.length < max : value.length === 0;

  const handleFiles = async (files: FileList | File[]) => {
    const arr = Array.from(files);
    if (arr.length === 0) return;

    // 单图只取第一张；多图按剩余容量截取
    const toUpload = multiple ? arr.slice(0, max - value.length) : [arr[0]];

    setUploading(true);
    try {
      const fd = new FormData();
      if (multiple) {
        for (const f of toUpload) fd.append("files", f);
      } else {
        fd.append("file", toUpload[0]);
      }

      const endpoint = multiple
        ? `${API_BASE}/api/upload/images`
        : `${API_BASE}/api/upload/image`;

      const res = await fetch(endpoint, {
        method: "POST",
        body: fd,
        credentials: "include",
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `上传失败 (${res.status})`);
      }

      const data = await res.json();

      if (multiple) {
        const urls = (data as { url: string }[]).map((d) => d.url);
        onChange([...value, ...urls]);
      } else {
        onChange([(data as { url: string }).url]);
      }
    } catch (e) {
      alert(`上传失败：${(e as Error).message}`);
    } finally {
      setUploading(false);
    }
  };

  const handleRemove = (index: number) => {
    onChange(value.filter((_, i) => i !== index));
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  };

  const addManual = () => {
    const url = manualInput.trim();
    if (!url) return;
    if (multiple) onChange([...value, url]);
    else onChange([url]);
    setManualInput("");
  };

  return (
    <div className="img-uploader">
      {label && <div className="img-uploader-label">{label}</div>}

      {/* 图片网格 */}
      <div className="img-uploader-grid">
        {value.map((img, i) => (
          <div key={i} className="img-uploader-item">
            <img src={toUrl(img)} alt="" />
            <button
              type="button"
              className="img-uploader-remove"
              onClick={() => handleRemove(i)}
              title="删除"
            >
              ×
            </button>
          </div>
        ))}

        {canAdd && (
          <button
            type="button"
            className={`img-uploader-add ${dragging ? "dragging" : ""}`}
            onClick={() => fileInputRef.current?.click()}
            onDrop={handleDrop}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              setDragging(false);
            }}
            disabled={uploading}
          >
            {uploading ? (
              <span className="img-uploader-spinner" />
            ) : (
              <>
                <span className="img-uploader-plus">+</span>
                <span className="img-uploader-hint">
                  {dragging ? "松开上传" : "点击或拖拽"}
                </span>
              </>
            )}
          </button>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple={multiple}
        className="hidden"
        onChange={(e) => {
          if (e.target.files) handleFiles(e.target.files);
          e.target.value = "";
        }}
      />

      {/* 手动输入 URL */}
      {showInput && (
        <div className="img-uploader-manual">
          <input
            type="text"
            value={manualInput}
            onChange={(e) => setManualInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addManual();
              }
            }}
            placeholder="或输入图片 URL"
          />
          <button type="button" onClick={addManual}>
            添加
          </button>
        </div>
      )}
    </div>
  );
}