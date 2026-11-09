"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

/**
 * 我的资料（关于页信息）
 *
 * 每个后台账号编辑**自己**的一份，存在 author_profiles 表。
 * 和「关于内容」(`/admin/profile`) 的区别：
 *   那个改的是站点的全局配置（首页那张个人卡片），只有管理员能动；
 *   这里改的是自己的档案，作者标签的昵称就取自 nickname 字段。
 *
 * 现阶段前台还没有成员关于页（阶段 3 做），所以这里保存后
 * 前台暂时看不到 —— 数据先攒着，接口已经通了。
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

const FIELDS: Array<{
  key: keyof Profile;
  label: string;
  placeholder?: string;
  textarea?: boolean;
  rows?: number;
}> = [
  { key: "nickname", label: "昵称", placeholder: "作者标签上显示的名字" },
  { key: "avatar_url", label: "头像地址", placeholder: "/media/... 或 https://..." },
  { key: "bio", label: "一句话简介", textarea: true, rows: 2 },
  { key: "social_github", label: "GitHub", placeholder: "https://github.com/xxx" },
  { key: "social_email", label: "Email", placeholder: "you@example.com" },
  { key: "social_telegram", label: "Telegram", placeholder: "https://t.me/xxx" },
  { key: "social_discord", label: "Discord" },
  { key: "about_subtitle", label: "关于页副标题", placeholder: "HELLO WORLD" },
  { key: "about_banner", label: "关于页横幅图", placeholder: "/media/..." },
  { key: "about_content", label: "关于页正文（Markdown）", textarea: true, rows: 12 },
];

export default function MyProfilePage() {
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

      <div className="admin-panel space-y-3">
        <div className="admin-panel__title">个人信息</div>
        <div className="admin-filters">
          {FIELDS.map((f) =>
            f.textarea ? (
              <label key={f.key} className="admin-field admin-field--grow">
                <span>{f.label}</span>
                <textarea
                  rows={f.rows ?? 4}
                  value={(profile[f.key] as string) ?? ""}
                  onChange={(e) =>
                    setProfile({ ...profile, [f.key]: e.target.value })
                  }
                />
              </label>
            ) : (
              <label key={f.key} className="admin-field">
                <span>{f.label}</span>
                <input
                  value={(profile[f.key] as string) ?? ""}
                  placeholder={f.placeholder}
                  onChange={(e) =>
                    setProfile({ ...profile, [f.key]: e.target.value })
                  }
                />
              </label>
            )
          )}
        </div>
      </div>

      <div className="admin-panel space-y-2">
        <div className="admin-panel__title">公开设置</div>
        <label className="admin-field">
          <span>在成员列表里公开我的关于页</span>
          <input
            type="checkbox"
            checked={profile.is_public}
            onChange={(e) =>
              setProfile({ ...profile, is_public: e.target.checked })
            }
          />
        </label>
        <p className="admin-muted text-xs">
          前台还没有成员关于页（阶段 3 做）。现在保存不会影响任何已上线的页面，
          但作者标签的昵称会立刻用上这里填的值。
        </p>
      </div>

      <div className="admin-actions">
        <button
          type="button"
          className="admin-btn"
          disabled={saving}
          onClick={() => void save()}
        >
          {saving ? "保存中..." : profile.role === "member" ? "提交" : "保存"}
        </button>
      </div>
    </div>
  );
}
