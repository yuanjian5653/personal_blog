"use client";

import { useEffect, useState } from "react";

import ImagePicker from "@/components/admin/ImagePicker";
import { api } from "@/lib/api";

/**
 * 「关于内容」表单 —— 管理员和成员共用一份
 *
 * 两边的字段其实是同一套：昵称 / 头像 / 简介 / 四个社交链接 / 关于页三件。
 * 差别只在**存到哪、叫什么名字**：
 *
 *   mode="site"（管理员）→ site_config
 *       GET/PUT /api/site-config
 *       author_name / author_avatar / author_bio / social_* / about_*
 *
 *   mode="self"（成员）→ author_profiles
 *       GET/PUT /api/admin/profile
 *       nickname / avatar_url / bio / social_* / about_* / is_public
 *
 * 所以这里只维护**一份字段定义**（SECTIONS，键用统一的逻辑名），
 * 再用 KEY_MAP 映到各自后端的字段名。
 *
 * 为什么值得合并：这两份表单以前是各写一套 JSX，加一个字段要改两处，
 * 时间一长必然一边有、一边没有（"成员那边没有简介"这种问题就是这么来的）。
 */
export type ProfileFormMode = "site" | "self";

interface FieldDef {
  key: string;
  label: string;
  type?: "text" | "textarea" | "image";
  placeholder?: string;
  rows?: number;
  hint?: string;
}

interface Section {
  title: string;
  fields: FieldDef[];
}

/** 四段式：个人信息 / 社交链接 / 关于页面 /（成员才有）其他设置 */
const SECTIONS: Section[] = [
  {
    title: "个人信息",
    fields: [
      {
        key: "nickname",
        label: "昵称",
        placeholder: "文章、说说旁边显示的名字",
        hint: "作者标签用的就是这个名字；留空会退回登录名。",
      },
      { key: "avatar", label: "头像", type: "image" },
      {
        key: "bio",
        label: "一句话简介",
        type: "textarea",
        rows: 2,
        placeholder: "一句话说明你是谁",
      },
    ],
  },
  {
    title: "社交链接",
    fields: [
      {
        key: "social_github",
        label: "GitHub",
        placeholder: "https://github.com/你的名字",
      },
      { key: "social_email", label: "Email", placeholder: "you@example.com" },
      {
        key: "social_telegram",
        label: "Telegram",
        placeholder: "https://t.me/你的名字",
      },
      { key: "social_discord", label: "Discord", placeholder: "用户名#1234" },
    ],
  },
  {
    title: "关于页面",
    fields: [
      {
        key: "about_subtitle",
        label: "英文副标题",
        placeholder: "HELLO WORLD",
      },
      { key: "about_banner", label: "顶部横幅图", type: "image" },
      {
        key: "about_content",
        label: "正文（Markdown）",
        type: "textarea",
        rows: 14,
        placeholder: "## 你好\n\n这里写关于你自己。",
      },
    ],
  },
];

/** 逻辑键 → 各模式下的真实字段名 */
const KEY_MAP: Record<ProfileFormMode, Record<string, string>> = {
  site: {
    nickname: "author_name",
    avatar: "author_avatar",
    bio: "author_bio",
    social_github: "social_github",
    social_email: "social_email",
    social_telegram: "social_telegram",
    social_discord: "social_discord",
    about_subtitle: "about_subtitle",
    about_banner: "about_banner",
    about_content: "about_content",
  },
  self: {
    nickname: "nickname",
    avatar: "avatar_url",
    bio: "bio",
    social_github: "social_github",
    social_email: "social_email",
    social_telegram: "social_telegram",
    social_discord: "social_discord",
    about_subtitle: "about_subtitle",
    about_banner: "about_banner",
    about_content: "about_content",
  },
};

interface SelfProfile {
  username: string;
  role: string;
  is_public: boolean;
  [key: string]: unknown;
}

export default function ProfileForm({ mode = "self" }: { mode?: ProfileFormMode }) {
  /** 逻辑键 → 值（字符串；is_public 单独存） */
  const [values, setValues] = useState<Record<string, string> | null>(null);
  const [isPublic, setIsPublic] = useState(false);
  const [username, setUsername] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const isSelf = mode === "self";
  const map = KEY_MAP[mode];

  useEffect(() => {
    let alive = true;

    if (isSelf) {
      api
        .get<SelfProfile>("/api/admin/profile")
        .then((p) => {
          if (!alive) return;
          const next: Record<string, string> = {};
          for (const [logical, real] of Object.entries(map)) {
            next[logical] = (p[real] as string) ?? "";
          }
          setValues(next);
          setIsPublic(Boolean(p.is_public));
          setUsername(p.username);
        })
        .catch(() => {
          if (alive) setMsg("加载失败");
        });
    } else {
      api
        .get<{ configs: Record<string, string> }>("/api/site-config")
        .then((r) => {
          if (!alive) return;
          const cfg = r.configs ?? {};
          const next: Record<string, string> = {};
          for (const [logical, real] of Object.entries(map)) {
            next[logical] = cfg[real] ?? "";
          }
          setValues(next);
        })
        .catch(() => {
          if (alive) setMsg("加载失败");
        });
    }

    return () => {
      alive = false;
    };
    // map 由 mode 决定，随 mode 变；其余是恒定引用
  }, [isSelf, map]);

  const setField = (key: string, value: string) => {
    setValues((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const save = async () => {
    if (!values) return;
    setSaving(true);
    setMsg("");
    try {
      if (isSelf) {
        const payload: Record<string, string | boolean> = {};
        for (const [logical, real] of Object.entries(map)) {
          payload[real] = values[logical] ?? "";
        }
        payload.is_public = isPublic;
        await api.put("/api/admin/profile", payload);
      } else {
        // 只提交本表单涉及的键：site_config 里还有其它配置
        // （背景、备案号、网易云 Cookie 等），整份覆盖会误伤。
        const configs: Record<string, string> = {};
        for (const [logical, real] of Object.entries(map)) {
          configs[real] = values[logical] ?? "";
        }
        await api.put("/api/site-config", { configs });
      }
      setMsg("已保存");
      window.setTimeout(() => setMsg(""), 3000);
    } catch (e) {
      setMsg(`保存失败：${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  if (!values) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">{isSelf ? "我的资料" : "关于内容"}</h1>
        <p className="admin-muted">{msg || "加载中..."}</p>
      </div>
    );
  }

  const missingIdentity =
    isSelf && (!values.nickname?.trim() || !values.avatar?.trim());

  const renderFields = (fields: FieldDef[]) => (
    // 一行一个输入框：这里**不用** admin-filters（那是横排 flex，
    // 会让两个字段左右并排），改成纵向堆叠。
    <div className="space-y-3">
      {fields.map((f) => (
        <label key={f.key} className="admin-field">
          <span>{f.label}</span>
          {f.type === "image" ? (
            <ImagePicker
              value={values[f.key] ?? ""}
              onChange={(url) => setField(f.key, url)}
            />
          ) : f.type === "textarea" ? (
            <textarea
              rows={f.rows ?? 4}
              value={values[f.key] ?? ""}
              placeholder={f.placeholder}
              onChange={(e) => setField(f.key, e.target.value)}
            />
          ) : (
            <input
              value={values[f.key] ?? ""}
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold">{isSelf ? "我的资料" : "关于内容"}</h1>
        {isSelf && username ? (
          <span className="admin-muted text-xs">
            登录名 <code className="admin-code">{username}</code>
          </span>
        ) : null}
      </div>

      {/* 没填昵称或头像时，前台作品没有作者信息 —— 提前提示 */}
      {missingIdentity && (
        <p className="admin-error">
          还缺昵称或头像 —— 前台内容旁的作者标签会用这里的昵称和头像。
          填好再发布作品，读者才看得到作者信息。
        </p>
      )}

      {msg && (
        <p className={msg.includes("失败") ? "admin-error" : "admin-ok"}>
          {msg}
        </p>
      )}

      {SECTIONS.map((section) => (
        <div key={section.title} className="admin-panel space-y-3">
          <div className="admin-panel__title">{section.title}</div>
          {renderFields(section.fields)}
        </div>
      ))}

      {/* ④ 其他设置：只有成员有「公开我的关于页」这个开关 */}
      {isSelf && (
        <div className="admin-panel space-y-3">
          <div className="admin-panel__title">其他设置</div>
          <div className="flex items-center gap-2">
            <input
              id="profile-is-public"
              type="checkbox"
              checked={isPublic}
              onChange={(e) => setIsPublic(e.target.checked)}
            />
            <label htmlFor="profile-is-public" className="text-sm">
              在成员列表里公开我的关于页
            </label>
          </div>
          <p className="admin-muted text-xs">
            默认关闭。开启后，「关于」页面顶部的切换栏里会出现你，
            别人也能看到你的昵称、简介、社交链接和关于页正文。
          </p>
        </div>
      )}

      {!isSelf && (
        <p className="admin-muted text-xs">
          这里是「关于内容」，同时用于两处：首页那张个人卡片的轮播，
          以及「关于」页面里你自己那一栏。
          网站本身的介绍在「站点配置 → 网站介绍」里改。
        </p>
      )}

      <div className="admin-actions">
        <button
          type="button"
          className="admin-btn"
          disabled={saving}
          onClick={() => void save()}
        >
          {saving ? "保存中..." : isSelf ? "提交" : "保存"}
        </button>
      </div>
    </div>
  );
}
