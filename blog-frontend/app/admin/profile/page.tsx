"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import ImagePicker from "@/components/admin/ImagePicker";

// 字段定义
const FIELDS: Array<{
  group: string;
  hint?: string;
  items: Array<{
    key: string;
    label: string;
    type: "text" | "textarea" | "color" | "image";
    placeholder?: string;
    rows?: number;
  }>;
}> = [
  {
    group: "个人信息",
    hint: "这些信息会同时显示在首页作者卡片和关于页面",
    items: [
      { key: "author_name", label: "昵称", type: "text" },
      { key: "author_avatar", label: "头像", type: "image" },
      { key: "author_bio", label: "简介", type: "textarea", rows: 2 },
    ],
  },
  {
    group: "首页统计数字",
    hint: "首页作者卡片底部显示的数字",
    items: [
      { key: "author_stats_articles", label: "文章数", type: "text" },
      { key: "author_stats_posts", label: "说说数", type: "text" },
      { key: "author_stats_photos", label: "照片数", type: "text" },
    ],
  },
  {
    group: "社交链接",
    hint: "留空则不显示对应图标",
    items: [
      { key: "social_github", label: "GitHub", type: "text", placeholder: "https://github.com/xxx" },
      { key: "social_email", label: "Email", type: "text", placeholder: "mailto:xxx@xxx.com" },
      { key: "social_telegram", label: "Telegram", type: "text", placeholder: "https://t.me/xxx" },
      { key: "social_discord", label: "Discord", type: "text" },
    ],
  },
  {
    group: "关于页面",
    hint: "关于页面顶部横幅、副标题和 Markdown 内容",
    items: [
      { key: "about_subtitle", label: "英文副标题", type: "text", placeholder: "HELLO WORLD, I'M ..." },
      { key: "about_banner", label: "顶部横幅图", type: "image" },
      { key: "about_content", label: "正文（Markdown）", type: "textarea", rows: 14 },
    ],
  },
];

export default function AdminProfilePage() {
  const [configs, setConfigs] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ configs: Record<string, string> }>("/api/site-config")
      .then((d) => setConfigs(d.configs))
      .catch((e) => setMsg(`加载失败：${e.message}`))
      .finally(() => setLoading(false));
  }, []);

  const update = (key: string, value: string) => {
    setConfigs((prev) => ({ ...prev, [key]: value }));
  };

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      // 只提交本页相关的配置项，避免覆盖其他页改的东西
      const payload: Record<string, string> = {};
      FIELDS.forEach((g) => {
        g.items.forEach((item) => {
          payload[item.key] = configs[item.key] ?? "";
        });
      });
      await api.put("/api/site-config", { configs: payload });
      setMsg("已保存，刷新首页或关于页即可看到效果");
    } catch (e) {
      setMsg(`保存失败：${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div>加载中...</div>;

  return (
    <div className="space-y-6 max-w-3xl">
      {/* 顶部 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">关于内容</h1>
          <p className="text-xs mt-1" style={{ color: "var(--text-secondary)" }}>
            管理首页作者卡片和关于页面的全部内容
          </p>
        </div>
        <button
          onClick={save}
          disabled={saving}
          className="px-4 py-2 rounded-lg text-sm disabled:opacity-50"
          style={{ background: "var(--accent)", color: "#fff" }}
        >
          {saving ? "保存中..." : "保存"}
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

      {/* 字段分组 */}
      {FIELDS.map((group) => (
        <section key={group.group} className="glass p-6 space-y-4">
          <div className="mb-2">
            <h2
              className="text-sm font-semibold uppercase tracking-wider"
              style={{ color: "var(--text-secondary)" }}
            >
              {group.group}
            </h2>
            {group.hint && (
              <p className="text-xs mt-1" style={{ color: "var(--text-secondary)", opacity: 0.7 }}>
                {group.hint}
              </p>
            )}
          </div>

          {group.items.map((field) => (
            <div key={field.key}>
              <label
                className="block text-xs mb-2"
                style={{ color: "var(--text-secondary)" }}
              >
                {field.label}
              </label>

              {/* 图片字段用 ImagePicker */}
              {field.type === "image" ? (
                <ImagePicker
                  value={configs[field.key] ?? ""}
                  onChange={(url) => update(field.key, url)}
                />
              ) : field.type === "textarea" ? (
                <textarea
                  value={configs[field.key] ?? ""}
                  rows={field.rows || 4}
                  placeholder={field.placeholder}
                  onChange={(e) => update(field.key, e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 focus:border-[var(--accent)] outline-none text-sm resize-y"
                  style={{ fontFamily: field.key.includes("content") ? "var(--font-geist-mono), monospace" : undefined }}
                />
              ) : field.type === "color" ? (
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={configs[field.key] ?? "#000000"}
                    onChange={(e) => update(field.key, e.target.value)}
                    className="w-12 h-9 rounded cursor-pointer bg-transparent"
                  />
                  <input
                    type="text"
                    value={configs[field.key] ?? ""}
                    onChange={(e) => update(field.key, e.target.value)}
                    className="flex-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10 focus:border-[var(--accent)] outline-none text-sm font-mono"
                  />
                </div>
              ) : (
                <input
                  type="text"
                  value={configs[field.key] ?? ""}
                  placeholder={field.placeholder}
                  onChange={(e) => update(field.key, e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 focus:border-[var(--accent)] outline-none text-sm"
                />
              )}
            </div>
          ))}
        </section>
      ))}

      {/* 底部再放一个保存按钮，长表单方便 */}
      <div className="flex justify-end">
        <button
          onClick={save}
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