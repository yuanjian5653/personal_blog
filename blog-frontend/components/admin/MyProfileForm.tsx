"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import ImagePicker from "@/components/admin/ImagePicker";

/**
 * 个人资料表单（成员视角的「关于内容」）
 *
 * 版式与「关于内容」(/admin/profile) 保持一致的四段式：
 *   ① 个人信息   ② 社交链接   ③ 关于页面   ④ 其他设置
 *
 * 由 /admin/profile 在「成员」身份下渲染；管理员那边仍编辑站点级配置。
 *
 * 区别只在于数据落到哪里：
 *   /admin/profile    → site_config 全局配置（首页那张个人卡片，仅管理员）
 *   这里              → author_profiles 里**自己**的一份（每个账号各一份）
 *
 * 现阶段前台还没有成员关于页（阶段 3），保存只落库；
 * 但作者标签的昵称立刻用 nickname 的值。
 */
interface Profile {
  admin_id: number;
  username: string;
  role: string;
  nickname: string | null;
  avatar_url: string | null;
  bio: string | null;
  social_github: string | null;
  social_email: string | null;
  social_telegram: string | null;
  social_discord: string | null;
  about_banner: string | null;
  about_subtitle: string | null;
  about_content: string | null;
  is_public: boolean;
}

type FieldDef = {
  key: keyof Profile;
  label: string;
  placeholder?: string;
  textarea?: boolean;
  rows?: number;
  grow?: boolean;
  hint?: string;
};

/** ① 个人信息 —— 作者标签与成员卡片都用这里的昵称和头像 */
const BASIC: FieldDef[] = [
  {
    key: "nickname",
    label: "昵称",
    placeholder: "作者标签上显示的名字",
    hint: "前台内容旁的作者标签用的就是它",
  },
  { key: "avatar_url", label: "头像地址", placeholder: "/media/photos/xxx.jpg" },
  { key: "bio", label: "一句话简介", textarea: true, rows: 2, grow: true },
];

/** ② 社交链接 —— 留空则不显示 */
const SOCIALS: FieldDef[] = [
  { key: "social_github", label: "GitHub", placeholder: "https://github.com/你的名字" },
  { key: "social_email", label: "Email", placeholder: "you@example.com" },
  { key: "social_telegram", label: "Telegram", placeholder: "https://t.me/你的名字" },
  { key: "social_discord", label: "Discord", placeholder: "用户名#1234" },
];

/** ③ 关于页面 —— 阶段 3 会渲染到 /members/[昵称] */
const ABOUT: FieldDef[] = [
  { key: "about_subtitle", label: "英文副标题", placeholder: "HELLO WORLD" },
  { key: "about_banner", label: "顶部横幅图", placeholder: "/media/photos/xxx.jpg" },
  {
    key: "about_content",
    label: "正文（Markdown）",
    textarea: true,
    rows: 12,
    grow: true,
    hint: "支持 Markdown；阶段 3 上线后会展示在你的个人页",
  },
];

export default function MyProfileForm() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .get<Profile>("/api/admin/profile")
      .then((p) => {
        if (alive) setProfile(p);
      })
      .catch(() => {
        if (alive) setMsg("加载失败");
      });
    return () => {
      alive = false;
    };
  }, []);

  const setField = (key: keyof Profile, value: string | boolean) => {
    setProfile((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const save = async () => {
    if (!profile) return;
    setSaving(true);
    setMsg("");
    try {
      const saved = await api.put<Profile>("/api/admin/profile", {
        nickname: profile.nickname,
        avatar_url: profile.avatar_url,
        bio: profile.bio,
        social_github: profile.social_github,
        social_email: profile.social_email,
        social_telegram: profile.social_telegram,
        social_discord: profile.social_discord,
        about_subtitle: profile.about_subtitle,
        about_banner: profile.about_banner,
        about_content: profile.about_content,
        is_public: profile.is_public,
      });
      setProfile(saved);
      setMsg("已保存");
      window.setTimeout(() => setMsg(""), 3000);
    } catch (e) {
      setMsg(`保存失败：${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const renderFields = (fields: FieldDef[]) => (
    // 一行一个输入框：这里**不用** admin-filters（那是横排 flex，
    // 会让两个字段左右并排），改成纵向堆叠，和管理员页的观感一致。
    <div className="space-y-3">
      {fields.map((f) => (
        <label
          key={f.key}
          className={
            f.grow ? "admin-field admin-field--grow" : "admin-field"
          }
        >
          <span>{f.label}</span>
          {f.key === "avatar_url" || f.key === "about_banner" ? (
            <ImagePicker
              value={(profile?.[f.key] as string) ?? ""}
              onChange={(url) => setField(f.key, url)}
            />
          ) : f.textarea ? (
            <textarea
              rows={f.rows ?? 4}
              value={(profile?.[f.key] as string) ?? ""}
              placeholder={f.placeholder}
              onChange={(e) => setField(f.key, e.target.value)}
            />
          ) : (
            <input
              value={(profile?.[f.key] as string) ?? ""}
              placeholder={f.placeholder}
              onChange={(e) => setField(f.key, e.target.value)}
            />
          )}
          {f.hint ? (
            <small className="admin-muted text-xs">{f.hint}</small>
          ) : null}
        </label>
      ))}
    </div>
  );

  if (!profile) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">我的资料</h1>
        <p className="admin-muted">{msg || "加载中..."}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold">我的资料</h1>
        <span className="admin-muted text-xs">
          登录名 <code className="admin-code">{profile.username}</code>
        </span>
      </div>

      {msg && (
        <p className={msg.includes("失败") ? "admin-error" : "admin-ok"}>
          {msg}
        </p>
      )}

      {/* ① 个人信息 */}
      <div className="admin-panel space-y-3">
        <div className="admin-panel__title">个人信息</div>
        {renderFields(BASIC)}
      </div>

      {/* ② 社交链接 */}
      <div className="admin-panel space-y-3">
        <div className="admin-panel__title">社交链接</div>
        {renderFields(SOCIALS)}
      </div>

      {/* ③ 关于页面 */}
      <div className="admin-panel space-y-3">
        <div className="admin-panel__title">关于页面</div>
        {renderFields(ABOUT)}
      </div>

      {/* ④ 其他设置 */}
      <div className="admin-panel space-y-3">
        <div className="admin-panel__title">其他设置</div>
        <label className="admin-field">
          <span>在成员列表里公开我的关于页</span>
          <input
            type="checkbox"
            checked={profile.is_public}
            onChange={(e) => setField("is_public", e.target.checked)}
          />
        </label>
        <p className="admin-muted text-xs">
          默认关闭。开启后，阶段 3 上线的 /members 列表里会列出你。
          现在保存不会影响任何已上线页面，但作者标签的昵称会立刻生效。
        </p>
      </div>

      <div className="admin-actions">
        <button
          type="button"
          className="admin-btn"
          disabled={saving}
          onClick={() => void save()}
        >
          {saving
            ? "保存中..."
            : profile.role === "member"
              ? "提交"
              : "保存"}
        </button>
      </div>
    </div>
  );
}
