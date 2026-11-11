"use client";

import ColorInput from "@/components/admin/ColorInput";
import { useEffect, useState } from "react";

import ImagePicker from "@/components/admin/ImagePicker";
import ReviewStatusBadge from "@/components/admin/ReviewStatusBadge";
import { api } from "@/lib/api";
import { useRole } from "@/lib/useRole";
import type { Album } from "@/lib/types";
import type { ThemeLike } from "@/lib/theme";

/**
 * 我的主题（成员和管理员都能进）
 *
 * 上半部分：编辑自己的一套主题 —— 就是「站点配置」里的
 *   主题与背景 + 首页卡片 这两块，字段一一对应。
 *
 * 下半部分（仅管理员）：所有成员的主题列表 + 上线开关。
 *   上线的才会出现在前台导航栏的主题切换器里。
 */
export default function ThemePage() {
  const role = useRole();
  const isAdmin = role === "admin";

  const [mine, setMine] = useState<ThemeLike | null>(null);
  const [all, setAll] = useState<ThemeLike[] | null>(null);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    api
      .get<ThemeLike>("/api/admin/my-theme")
      .then((t) => {
        if (alive) setMine(t);
      })
      .catch(() => {
        if (alive) setError("加载失败");
      });
    api
      .get<Album[]>("/api/albums?mine=1")
      .then((rows) => {
        if (alive) setAlbums(rows);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  // 管理员额外拉全部主题
  useEffect(() => {
    if (!isAdmin) return;
    let alive = true;
    api
      .get<ThemeLike[]>("/api/admin/themes")
      .then((rows) => {
        if (alive) setAll(rows);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [isAdmin]);

  const set = <K extends keyof ThemeLike>(key: K, value: ThemeLike[K]) => {
    setMine((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const save = async () => {
    if (!mine) return;
    setSaving(true);
    setError("");
    setMsg("");
    try {
      const saved = await api.put<ThemeLike>("/api/admin/my-theme", {
        name: mine.name,
        theme_accent: mine.theme_accent,
        bg_type: mine.bg_type,
        bg_color: mine.bg_color,
        bg_image: mine.bg_image,
        bg_blur: mine.bg_blur,
        bg_overlay: mine.bg_overlay,
        card_text: mine.card_text,
        card_wave_color1: mine.card_wave_color1,
        card_wave_color2: mine.card_wave_color2,
        home_album_id: mine.home_album_id,
      });
      setMine(saved);
      setMsg("已保存");
      window.setTimeout(() => setMsg(""), 3000);
      if (isAdmin) {
        // 列表里自己的那条也要更新
        setAll((prev) =>
          prev ? prev.map((t) => (t.admin_id === saved.admin_id ? saved : t)) : prev
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const togglePublish = async (t: ThemeLike) => {
    setError("");
    try {
      const saved = await api.put<ThemeLike>(
        `/api/admin/themes/${t.admin_id}/publish`,
        { is_published: !t.is_published }
      );
      setAll((prev) =>
        prev ? prev.map((x) => (x.admin_id === saved.admin_id ? saved : x)) : prev
      );
      setMsg(saved.is_published ? "已上线" : "已下线");
      window.setTimeout(() => setMsg(""), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    }
  };

  if (!mine) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">我的主题</h1>
        <p className="admin-muted">{error || "加载中…"}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold">我的主题</h1>
        <span className="admin-muted text-xs">
          {mine.is_published ? "已在后台线上，访客可切换" : "未上线，只有你自己能看到"}
        </span>
      </div>

      {error && <p className="admin-error">{error}</p>}
      {msg && <p className="admin-ok">{msg}</p>}

      <p className="admin-muted text-xs">
        前台的默认外观来自「站点配置」里站长的那一套。你在这里做的主题是**额外的一套**，
        管理员点「上线」之后才会出现在前台导航栏的切换按钮里。
        卡片是毛玻璃还是纯黑由导航栏的「日夜切换」单独控制，不在这里设。
      </p>

      {/* ---------- 基本信息 ---------- */}
      <div className="admin-panel space-y-3">
        <div className="admin-panel__title">主题名称</div>
        <label className="admin-field">
          <span>名字（显示在切换器里）</span>
          <input
            value={mine.name}
            maxLength={50}
            placeholder="例如：星空紫"
            onChange={(e) => set("name", e.target.value)}
          />
        </label>
      </div>

      {/* ---------- 主题与背景 ---------- */}
      <div className="admin-panel space-y-3">
        <div className="admin-panel__title">主题与背景</div>

        <label className="admin-field">
          <span>强调色</span>
          <ColorInput
            value={mine.theme_accent}
            onChange={(v) => set("theme_accent", v)}
          />
        </label>

        <div className="admin-actions">
          <span className="admin-muted text-xs">背景类型：</span>
          <button
            type="button"
            className={mine.bg_type === "color" ? "admin-btn" : "admin-btn admin-btn--ghost"}
            onClick={() => set("bg_type", "color")}
          >
            纯色
          </button>
          <button
            type="button"
            className={mine.bg_type === "image" ? "admin-btn" : "admin-btn admin-btn--ghost"}
            onClick={() => set("bg_type", "image")}
          >
            图片
          </button>
        </div>

        {mine.bg_type === "color" ? (
          <label className="admin-field">
            <span>背景色</span>
            <ColorInput
            value={mine.bg_color}
            onChange={(v) => set("bg_color", v)}
          />
          </label>
        ) : (
          <label className="admin-field">
            <span>背景图</span>
            <ImagePicker
              value={mine.bg_image}
              onChange={(url) => set("bg_image", url)}
            />
          </label>
        )}

        <label className="admin-field">
          <span>背景模糊（{mine.bg_blur}px）</span>
          <input
            type="range"
            min={0}
            max={30}
            step={1}
            value={mine.bg_blur}
            onChange={(e) => set("bg_blur", Number(e.target.value))}
          />
        </label>

        <label className="admin-field">
          <span>遮罩不透明度（{mine.bg_overlay}）</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={mine.bg_overlay}
            onChange={(e) => set("bg_overlay", Number(e.target.value))}
          />
        </label>

      </div>

      {/* ---------- 首页卡片 ---------- */}
      <div className="admin-panel space-y-3">
        <div className="admin-panel__title">首页卡片</div>

        <label className="admin-field">
          <span>文字卡片内容</span>
          <textarea
            rows={3}
            value={mine.card_text}
            maxLength={2000}
            placeholder="首页那张文字卡片上显示的句子"
            onChange={(e) => set("card_text", e.target.value)}
          />
        </label>

        <label className="admin-field">
          <span>波频起始色</span>
          <ColorInput
            value={mine.card_wave_color1}
            onChange={(v) => set("card_wave_color1", v)}
          />
        </label>

        <label className="admin-field">
          <span>波频结束色</span>
          <ColorInput
            value={mine.card_wave_color2}
            onChange={(v) => set("card_wave_color2", v)}
          />
        </label>

        <label className="admin-field">
          <span>首页图片卡片显示的相册</span>
          <select
            value={mine.home_album_id ?? ""}
            onChange={(e) =>
              set("home_album_id", e.target.value ? Number(e.target.value) : null)
            }
          >
            <option value="">（用站长的设置）</option>
            {albums.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="admin-actions">
        <button
          type="button"
          className="admin-btn"
          disabled={saving}
          onClick={() => void save()}
        >
          {saving ? "保存中…" : "保存我的主题"}
        </button>
      </div>

      {/* ---------- 管理员：所有人的主题 ---------- */}
      {isAdmin && (
        <div className="admin-panel admin-panel--flush">
          <div className="admin-panel__title p-4 pb-0">
            所有人的主题（上线后访客才能切换）
          </div>
          {all === null ? (
            <p className="admin-muted p-6">加载中…</p>
          ) : all.length === 0 ? (
            <p className="admin-muted p-6">
              还没有人设置主题。让成员去「我的主题」里做一套。
            </p>
          ) : (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>成员</th>
                  <th>主题名</th>
                  <th>预览</th>
                  <th>状态</th>
                  <th style={{ width: 120 }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {all.map((t) => (
                  <tr key={t.admin_id}>
                    <td>{t.owner_name}</td>
                    <td>{t.name}</td>
                    <td>
                      <span
                        className="admin-muted inline-block h-4 w-4 rounded-full align-middle"
                        style={{
                          background: t.theme_accent,
                          border: "1px solid rgba(255,255,255,0.3)",
                        }}
                      />
                      <span className="admin-muted text-xs ml-2">
                        {t.bg_type === "image" ? "背景图" : t.bg_color}
                      </span>
                    </td>
                    <td>
                      <ReviewStatusBadge
                        status={t.is_published ? "approved" : "pending"}
                      />
                      <span className="admin-muted text-xs ml-1">
                        {t.is_published ? "已上线" : "未上线"}
                      </span>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="admin-link"
                        onClick={() => void togglePublish(t)}
                      >
                        {t.is_published ? "下线" : "上线"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
