"use client";

import ReviewStatusBadge from "@/components/admin/ReviewStatusBadge";
import { saveMessage } from "@/lib/review";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import ImageUploader from "./ImageUploader";

interface FormData {
  title: string;
  content: string;
  excerpt: string;
  images: string[];
}

const EMPTY: FormData = {
  title: "",
  content: "",
  excerpt: "",
  images: [],
};

export default function EssayEditor() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id ? Number(params.id) : null;

  const [data, setData] = useState<FormData>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  // 审核状态：成员改完已通过的说说会重新进待审，得让它可见
  const [review, setReview] = useState<{
    status?: string;
    note?: string | null;
  }>({});
  // 记住"哪个 id 的数据已经到位"。null 表示新建（无需加载）。
  // 用 id 而不是布尔值，这样 id 变化时能自动回到加载中，且不必在 effect 里同步 setState。
  const [loadedId, setLoadedId] = useState<number | null>(null);
  const loading = id !== null && loadedId !== id;

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    api
      .get<{
        title: string;
        content: string;
        excerpt: string | null;
        images: string[];
        review_status?: string;
        review_note?: string | null;
      }>(`/api/essays/${id}`)
      .then((e) => {
        if (cancelled) return;
        setReview({ status: e.review_status, note: e.review_note });
        setData({
          title: e.title || "",
          content: e.content,
          excerpt: e.excerpt || "",
          images: e.images || [],
        });
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoadedId(id);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const update = (key: keyof FormData, value: unknown) => {
    setData((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    if (!data.content.trim() && data.images.length === 0) {
      setMsg("内容和图片至少填一个");
      return;
    }
    setSaving(true);
    setMsg(null);
    try {
      const payload = {
        title: data.title.trim(),
        content: data.content,
        excerpt: data.excerpt.trim() || null,
        images: data.images,
      };
      if (id) {
        const saved = await api.put<{
          review_status?: string;
          review_note?: string | null;
        }>(`/api/essays/${id}`, payload);
        setReview({ status: saved.review_status, note: saved.review_note });
        setMsg(saveMessage(saved.review_status));
      } else {
        const created = await api.post<{ id: number }>(
          "/api/essays",
          payload
        );
        router.replace(`/admin/essays/${created.id}`);
      }
    } catch (e) {
      setMsg(`保存失败：${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div>加载中...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">
          {id ? "编辑说说" : "新建说说"}
        </h1>
        {review.status && (
          <div className="flex items-center gap-2">
            <span className="admin-muted text-xs">审核状态：</span>
            <ReviewStatusBadge status={review.status} note={review.note} />
          </div>
        )}
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push("/admin/essays")}
            className="admin-btn admin-btn--ghost"
          >
            返回
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 rounded-lg text-sm disabled:opacity-50"
            style={{ background: "var(--adm-blue)", color: "#fff" }}
          >
            {saving ? "保存中..." : "保存"}
          </button>
        </div>
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

      <section className="glass p-6 space-y-4">
        {/* 标题 */}
        <div>
          <label
            className="block text-xs mb-2"
            style={{ color: "var(--text-secondary)" }}
          >
            标题（可选）
          </label>
          <input
            type="text"
            value={data.title}
            onChange={(e) => update("title", e.target.value)}
            placeholder="留空则不显示标题"
            className="admin-input"
          />
        </div>

        {/* 内容 */}
        <div>
          <label
            className="block text-xs mb-2"
            style={{ color: "var(--text-secondary)" }}
          >
            <span style={{ color: "#f87171" }}>* </span>内容
          </label>
          <textarea
            value={data.content}
            onChange={(e) => update("content", e.target.value)}
            rows={8}
            placeholder="随手写点什么..."
            className="admin-textarea"
            style={{ lineHeight: 1.7 }}
          />
        </div>

        {/* 图片 */}
        <div>
          <ImageUploader
            value={data.images}
            onChange={(imgs) => update("images", imgs)}
            multiple
            max={9}
            showInput
            label="图片（最多 9 张，支持拖拽或点击上传）"
          />
        </div>

        {/* 摘要 */}
        <div>
          <label
            className="block text-xs mb-2"
            style={{ color: "var(--text-secondary)" }}
          >
            摘要（可选，首页卡片用）
          </label>
          <input
            type="text"
            value={data.excerpt}
            onChange={(e) => update("excerpt", e.target.value)}
            className="admin-input"
          />
        </div>
      </section>

      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-6 py-2 rounded-lg text-sm disabled:opacity-50"
          style={{ background: "var(--adm-blue)", color: "#fff" }}
        >
          {saving ? "保存中..." : "保存"}
        </button>
      </div>
    </div>
  );
}