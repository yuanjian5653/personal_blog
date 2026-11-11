"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import ReviewStatusBadge from "@/components/admin/ReviewStatusBadge";
import ImageUploader from "@/components/admin/ImageUploader";
import { api } from "@/lib/api";
import { saveMessage } from "@/lib/review";

/**
 * 生活动态的编辑器（独立页面）
 *
 * 以前是列表页里的弹窗。为了和其他内容（文章 / 说说 / 图片组）
 * 保持一致，改成独立页面 —— 所有"编辑某一条"都是同一个交互：
 * 进页面、改、保存、返回列表。
 *
 * id 为 null 表示新建。
 */
interface LifePostDetail {
  id: number;
  content: string;
  images: string[];
  location: string | null;
  created_at: string;
  review_status?: string;
  review_note?: string | null;
}

export default function LifeEditor({ id }: { id: number | null }) {
  const router = useRouter();

  const [content, setContent] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [location, setLocation] = useState("");
  const [review, setReview] = useState<{ status?: string; note?: string | null }>(
    {}
  );
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  // 已加载到位的 id；新建模式天然就绪
  const [loadedId, setLoadedId] = useState<number | null>(null);
  const loading = id !== null && loadedId !== id;

  useEffect(() => {
    if (id === null) return;
    let cancelled = false;
    api
      .get<LifePostDetail>(`/api/life/${id}`)
      .then((p) => {
        if (cancelled) return;
        setContent(p.content || "");
        setImages(p.images || []);
        setLocation(p.location || "");
        setReview({ status: p.review_status, note: p.review_note });
      })
      .catch(() => setMsg("加载失败"))
      .finally(() => {
        if (!cancelled) setLoadedId(id);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const save = async () => {
    if (!content.trim() && images.length === 0) {
      setMsg("内容和图片至少填一个");
      return;
    }
    setSaving(true);
    setMsg(null);
    try {
      const payload = {
        content,
        images,
        location: location.trim() || null,
      };
      if (id !== null) {
        const saved = await api.put<{
          review_status?: string;
          review_note?: string | null;
        }>(`/api/life/${id}`, payload);
        setReview({ status: saved.review_status, note: saved.review_note });
        setMsg(saveMessage(saved.review_status));
      } else {
        const created = await api.post<{ id: number; review_status?: string }>(
          "/api/life",
          payload
        );
        // 新建后跳到编辑页，语义上和文章/说说一致
        router.replace(`/admin/life/${created.id}`);
        return;
      }
    } catch (e) {
      setMsg(`保存失败：${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="admin-muted p-6">加载中…</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="admin-btn admin-btn--ghost"
            onClick={() => router.push("/admin/life")}
          >
            ← 返回列表
          </button>
          <h1 className="text-2xl font-bold">
            {id ? "编辑动态" : "新建动态"}
          </h1>
        </div>
        {review.status && (
          <div className="flex items-center gap-2">
            <span className="admin-muted text-xs">审核状态：</span>
            <ReviewStatusBadge status={review.status} note={review.note} />
          </div>
        )}
      </div>

      {msg && (
        <p className={msg.includes("失败") ? "admin-error" : "admin-ok"}>{msg}</p>
      )}

      <div className="admin-panel space-y-3">
        <div className="admin-panel__title">内容</div>

        <label className="admin-field">
          <span>正文</span>
          <textarea
            rows={5}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="说点什么……"
          />
        </label>

        <ImageUploader
          value={images}
          onChange={setImages}
          multiple
          max={9}
          showInput
          label="图片（最多 9 张）"
        />

        <label className="admin-field">
          <span>位置（可选）</span>
          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="南昌市 高新区"
          />
        </label>
      </div>

      <div className="admin-actions">
        <button
          type="button"
          className="admin-btn"
          disabled={saving}
          onClick={() => void save()}
        >
          {saving ? "保存中…" : "保存"}
        </button>
        <button
          type="button"
          className="admin-btn admin-btn--ghost"
          onClick={() => router.push("/admin/life")}
        >
          取消
        </button>
      </div>
    </div>
  );
}
