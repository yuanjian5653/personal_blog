"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import ImagePicker from "@/components/admin/ImagePicker";
import type { Album } from "@/lib/types";

// 字段类型联合
type FieldType = "text" | "color" | "textarea" | "select" | "range" | "album";

interface FieldItem {
  key: string;
  label: string;
  type: FieldType;
  options?: Array<{ value: string; label: string }>;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
}

interface FieldGroup {
  group: string;
  items: FieldItem[];
}

const FIELDS: FieldGroup[] = [
  {
    group: "站点信息",
    items: [
      { key: "site_title", label: "站点标题", type: "text" as const },
      { key: "site_subtitle", label: "副标题", type: "text" as const },
    ],
  },
  {
    group: "主题与背景",
    items: [
      { key: "theme_accent", label: "主题强调色", type: "color" as const },
      {
        key: "bg_type", label: "背景类型", type: "select" as const,
        options: [
          { value: "color", label: "纯色" },
          { value: "image", label: "图片" },
        ],
      },
      { key: "bg_color", label: "背景色", type: "color" as const },
      { key: "bg_image", label: "背景图", type: "text" as const },
      { key: "bg_blur", label: "背景模糊 (px)", type: "range" as const, min: 0, max: 30, step: 1 },
      { key: "bg_overlay", label: "遮罩不透明度", type: "range" as const, min: 0, max: 1, step: 0.05 },
    ],
  },
  {
    group: "卡片样式",
    items: [
      {
        key: "card_style",
        label: "全局卡片样式",
        type: "select" as const,
        options: [
          { value: "glass", label: "原版毛玻璃" },
          { value: "black", label: "黑色毛玻璃" },
        ],
      },
    ],
  },
  {
    group: "首页卡片",
    items: [
      { key: "card_text", label: "文字卡片内容", type: "textarea" as const },
      { key: "card_wave_color1", label: "波频起始色", type: "color" as const },
      { key: "card_wave_color2", label: "波频结束色", type: "color" as const },
      { key: "home_album_id", label: "首页图片卡片显示的相册", type: "album" as const },
    ],
  },
  {
    group: "网站信息",
    items: [
      { key: "icp_number", label: "ICP 备案号", type: "text" as const },
      { key: "public_security_number", label: "公网安备号", type: "text" as const },
      {
        key: "site_started_at",
        label: "站点上线时间",
        type: "text" as const,
        placeholder: "2025-01-01（用于计算运行时长）",
      },
    ],
  },
];

export default function SiteConfigPage() {
  const [configs, setConfigs] = useState<Record<string, string>>({});
  const [albums, setAlbums] = useState<Album[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // 首次加载：拉配置 + 拉相册列表
  useEffect(() => {
    Promise.all([
      api.get<{ configs: Record<string, string> }>("/api/site-config"),
      api.get<Album[]>("/api/albums").catch(() => []),
    ])
      .then(([cfg, al]) => {
        setConfigs(cfg.configs);
        setAlbums(al);
      })
      .catch((e) => setMsg(`加载失败：${(e as Error).message}`))
      .finally(() => setLoading(false));
  }, []);

  const update = (key: string, value: string) => {
    setConfigs((prev) => ({ ...prev, [key]: value }));
  };

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      await api.put("/api/site-config", { configs });
      setMsg("已保存，返回前台即可看到效果");
    } catch (e) {
      setMsg(`保存失败：${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div>加载中...</div>;

  const isError = msg?.startsWith("保存失败") || msg?.startsWith("加载失败");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">站点配置</h1>
        <button
          onClick={save}
          disabled={saving}
          className="px-4 py-2 rounded-lg text-sm disabled:opacity-50"
          style={{ background: "var(--adm-blue)", color: "#fff" }}
        >
          {saving ? "保存中..." : "保存"}
        </button>
      </div>

      {msg && (
        <div
          className="text-sm px-4 py-2 rounded-lg"
          style={{
            background: isError ? "rgba(248,113,113,0.1)" : "rgba(34,197,94,0.1)",
            color: isError ? "#f87171" : "#4ade80",
          }}
        >
          {msg}
        </div>
      )}

      {FIELDS.map((group) => (
        <section key={group.group} className="glass p-6 space-y-4">
          <h2
            className="text-sm font-semibold uppercase tracking-wider"
            style={{ color: "var(--text-secondary)" }}
          >
            {group.group}
          </h2>

          {group.items.map((field) => (
            <div key={field.key}>
              <label
                className="block text-xs mb-2"
                style={{ color: "var(--text-secondary)" }}
              >
                {field.label}
              </label>

              {/* ===== 背景图：专门的图片选择器 ===== */}
              {field.key === "bg_image" ? (
                <ImagePicker
                  value={configs[field.key] ?? ""}
                  onChange={(url) => update(field.key, url)}
                />
              ) : field.type === "text" ? (
                /* ===== 文本输入 ===== */
                <input
                  type="text"
                  value={configs[field.key] ?? ""}
                  placeholder={field.placeholder}
                  onChange={(e) => update(field.key, e.target.value)}
                  className="admin-input"
                />
              ) : field.type === "textarea" ? (
                /* ===== 多行文本 ===== */
                <textarea
                  value={configs[field.key] ?? ""}
                  rows={3}
                  onChange={(e) => update(field.key, e.target.value)}
                  className="admin-input"
                />
              ) : field.type === "color" ? (
                /* ===== 颜色选择 ===== */
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
                    className="admin-input"
                  />
                </div>
              ) : field.type === "select" ? (
                /* ===== 普通下拉 ===== */
                <select
                  value={configs[field.key] ?? ""}
                  onChange={(e) => update(field.key, e.target.value)}
                  className="admin-input"
                >
                  {field.options?.map((o) => (
                    <option
                      key={o.value}
                      value={o.value}
                      style={{ background: "#171a21" }}
                    >
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : field.type === "range" ? (
                /* ===== 滑块 ===== */
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={field.min}
                    max={field.max}
                    step={field.step}
                    value={Number(configs[field.key] ?? 0)}
                    onChange={(e) => update(field.key, e.target.value)}
                    className="flex-1 accent-[var(--adm-blue)]"
                  />
                  <span
                    className="text-xs tabular-nums w-12 text-right"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    {configs[field.key]}
                  </span>
                </div>
              ) : field.type === "album" ? (
                /* ===== 相册选择下拉 ===== */
                <select
                  value={configs[field.key] ?? ""}
                  onChange={(e) => update(field.key, e.target.value)}
                  className="admin-input"
                >
                  <option value="" style={{ background: "#171a21" }}>
                    默认（第一个相册）
                  </option>
                  {albums.map((a) => (
                    <option
                      key={a.id}
                      value={a.id}
                      style={{ background: "#171a21" }}
                    >
                      {a.name}（{a.photo_count} 张）
                    </option>
                  ))}
                </select>
              ) : null}
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}