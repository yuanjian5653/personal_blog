"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import ImageUploader from "./ImageUploader";

interface FormData {
  title: string;
  slug: string;
  content: string;
  excerpt: string;
  cover_path: string;
  category: string;
  tags: string;
  is_pinned: boolean;
  status: string;
}

const EMPTY: FormData = {
  title: "",
  slug: "",
  content: "",
  excerpt: "",
  cover_path: "",
  category: "",
  tags: "",
  is_pinned: false,
  status: "published",
};

/** 读取 Word 导入暂存的待填数据（读不清除，清除交给 mount 后的 effect） */
function readPendingImport(): { title?: string; content?: string } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem("post_import_pending");
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export default function ArticleEditor() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id ? Number(params.id) : null;

  // 新建模式下，若刚从 Word 导入过，直接把内容作为初始值，
  // 这样不必在 effect 里同步 setData。
  // （readPendingImport 无副作用，只读取；惰性初始化只跑一次）
  const [data, setData] = useState<FormData>(() => {
    const pending = id === null ? readPendingImport() : null;
    return pending
      ? {
          ...EMPTY,
          title: pending.title || EMPTY.title,
          content: pending.content || EMPTY.content,
        }
      : EMPTY;
  });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(() =>
    id === null && readPendingImport()
      ? "已导入文档内容，请确认分类、标签后保存"
      : null
  );
  // 记录"哪个 id 的数据已经到位"：数字=该 id 已加载；null=尚未就绪。
  // 新建模式（id === null）视为天然就绪，不需要请求，也不需要写 state。
  const [loadedId, setLoadedId] = useState<number | null>(null);
  const loading = id !== null && loadedId !== id;

  // 暂存数据用完即清（副作用放在 effect 里，不在渲染期做）
  useEffect(() => {
    if (id !== null) return;
    try {
      sessionStorage.removeItem("post_import_pending");
    } catch {}
  }, [id]);

  useEffect(() => {
    if (id === null) return; // 新建模式：无需请求
    let cancelled = false;
    api
      .get<{
        title: string;
        slug: string;
        content: string;
        excerpt: string | null;
        cover_path: string | null;
        category: string | null;
        tags: string | null;
        is_pinned: boolean;
        status: string;
      }>(`/api/articles/${id}`)
      .then((a) => {
        if (cancelled) return;
        setData({
          title: a.title,
          slug: a.slug || "",
          content: a.content,
          excerpt: a.excerpt || "",
          cover_path: a.cover_path || "",
          category: a.category || "",
          tags: a.tags || "",
          is_pinned: a.is_pinned || false,
          status: a.status || "published",
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
    if (!data.title.trim()) {
      setMsg("标题不能为空");
      return;
    }
    setSaving(true);
    setMsg(null);
    try {
      const payload = {
        title: data.title.trim(),
        slug: data.slug.trim() || null,
        content: data.content,
        excerpt: data.excerpt.trim() || null,
        cover_path: data.cover_path.trim() || null,
        category: data.category.trim() || null,
        tags: data.tags.trim() || null,
        is_pinned: data.is_pinned,
        status: data.status,
      };
      if (id) {
        await api.put(`/api/articles/${id}`, payload);
        setMsg("已保存");
      } else {
        const created = await api.post<{ id: number }>(
          "/api/articles",
          payload
        );
        router.replace(`/admin/posts/${created.id}`);
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
        <h1 className="text-2xl font-bold">{id ? "编辑文章" : "新建文章"}</h1>
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push("/admin/posts")}
            className="px-4 py-2 rounded-lg text-sm border border-white/10 hover:bg-white/5"
          >
            返回
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

      {msg && (
        <div
          className="text-sm px-4 py-2 rounded-lg"
          style={{
            background: msg.includes("失败")
              ? "rgba(248,113,113,0.1)"
              : msg.includes("已从 Word 导入")
              ? "rgba(124,92,255,0.1)"
              : "rgba(34,197,94,0.1)",
            color: msg.includes("失败")
              ? "#f87171"
              : msg.includes("已从 Word 导入")
              ? "#a78bfa"
              : "#4ade80",
          }}
        >
          {msg}
        </div>
      )}

      <section className="glass p-6 space-y-4">
        <div>
          <label
            className="block text-xs mb-2"
            style={{ color: "var(--text-secondary)" }}
          >
            <span style={{ color: "#f87171" }}>* </span>标题
          </label>
          <input
            type="text"
            value={data.title}
            onChange={(e) => update("title", e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 focus:border-[var(--accent)] outline-none text-sm"
          />
        </div>

        <div>
          <label
            className="block text-xs mb-2"
            style={{ color: "var(--text-secondary)" }}
          >
            URL 别名（slug，留空自动生成）
          </label>
          <input
            type="text"
            value={data.slug}
            onChange={(e) => update("slug", e.target.value)}
            placeholder="my-first-post"
            className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 focus:border-[var(--accent)] outline-none text-sm"
          />
        </div>

        <div>
          <label
            className="block text-xs mb-2"
            style={{ color: "var(--text-secondary)" }}
          >
            摘要
          </label>
          <textarea
            value={data.excerpt}
            onChange={(e) => update("excerpt", e.target.value)}
            rows={3}
            className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 focus:border-[var(--accent)] outline-none text-sm resize-none"
          />
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div>
            <label
              className="block text-xs mb-2"
              style={{ color: "var(--text-secondary)" }}
            >
              分类
            </label>
            <input
              type="text"
              value={data.category}
              onChange={(e) => update("category", e.target.value)}
              placeholder="技术 / 生活"
              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 focus:border-[var(--accent)] outline-none text-sm"
            />
          </div>
          <div>
            <label
              className="block text-xs mb-2"
              style={{ color: "var(--text-secondary)" }}
            >
              状态
            </label>
            <select
              value={data.status}
              onChange={(e) => update("status", e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 focus:border-[var(--accent)] outline-none text-sm"
            >
              <option value="published" style={{ background: "#171a21" }}>
                已发布
              </option>
              <option value="draft" style={{ background: "#171a21" }}>
                草稿
              </option>
            </select>
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={data.is_pinned}
                onChange={(e) => update("is_pinned", e.target.checked)}
                className="accent-[var(--accent)]"
              />
              <span className="text-sm">置顶</span>
            </label>
          </div>
        </div>

        <div>
          <label
            className="block text-xs mb-2"
            style={{ color: "var(--text-secondary)" }}
          >
            标签（逗号分隔）
          </label>
          <input
            type="text"
            value={data.tags}
            onChange={(e) => update("tags", e.target.value)}
            placeholder="react,fastapi"
            className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 focus:border-[var(--accent)] outline-none text-sm"
          />
        </div>

        <div>
          <ImageUploader
            value={data.cover_path ? [data.cover_path] : []}
            onChange={(v) => update("cover_path", v[0] || "")}
            multiple={false}
            showInput
            label="封面图（点击 + 上传，或手动填 URL）"
          />
        </div>
      </section>

      <section className="glass p-6 space-y-3">
        <label
          className="block text-xs"
          style={{ color: "var(--text-secondary)" }}
        >
          正文（Markdown）
        </label>
        <textarea
          value={data.content}
          onChange={(e) => update("content", e.target.value)}
          rows={25}
          placeholder="# 标题&#10;&#10;正文..."
          className="w-full px-4 py-3 rounded-lg bg-white/5 border border-white/10 focus:border-[var(--accent)] outline-none text-sm resize-y"
          style={{
            fontFamily: "var(--font-geist-mono), monospace",
            lineHeight: 1.7,
          }}
        />
      </section>

      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-6 py-2 rounded-lg text-sm disabled:opacity-50"
          style={{ background: "var(--accent)", color: "#fff" }}
        >
          {saving ? "保存中..." : "保存"}
        </button>
      </div>
    </div>
  );
}