"use client";

import { useState } from "react";
import { MorphIcon } from "morphicons/react";

import {
  DEFAULT_CATEGORY,
  KIND_HINT,
  KIND_LABEL,
  KIND_PLACEHOLDER,
  type ToolInput,
  type ToolKind,
} from "@/lib/tools";
import {
  FALLBACK_ICON_NAME,
  TOOL_ICON_NAMES,
  isToolIconName,
  resolveToolIcon,
} from "./icons";

/**
 * 工具表单（新建与编辑共用）。
 *
 * 抽成一个组件的原因：新建页和编辑页除了"初始值"和"提交动作"以外完全一样，
 * 各写一遍必然慢慢走样（项目里友链/项目就是这么长成两套的）。
 *
 * 校验分两层：
 *   前端 —— 必填项没填时禁用保存按钮（快速反馈）
 *   后端 —— 真正的规则（slug 唯一、kind 与 href 是否匹配）由接口判定
 *
 * 编辑页切换工具时，父组件用 key={id} 让本组件重建，所以内部状态不用同步。
 */
interface Props {
  initial: ToolInput;
  submitText: string;
  busy: boolean;
  error: string | null;
  onSubmit: (data: ToolInput) => void;
  onCancel: () => void;
  /** 已有分类，用 datalist 提示，避免手打错别字 */
  categories: string[];
}

export default function ToolForm({
  initial,
  submitText,
  busy,
  error,
  onSubmit,
  onCancel,
  categories,
}: Props) {
  const [form, setForm] = useState<ToolInput>(initial);

  const set = <K extends keyof ToolInput>(key: K, value: ToolInput[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const kind = form.kind as ToolKind;
  const PreviewIcon = resolveToolIcon(form.icon);
  // 记录里可能是注册表里没有的图标名（早期数据），select 要能显示一个有效值
  const selectIcon = isToolIconName(form.icon)
    ? form.icon
    : FALLBACK_ICON_NAME;

  const canSubmit =
    form.name.trim().length > 0 && form.href.trim().length > 0 && !busy;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    onSubmit({
      ...form,
      name: form.name.trim(),
      slug: form.slug.trim(),
      href: form.href.trim(),
      summary: form.summary.trim(),
      category: form.category.trim() || DEFAULT_CATEGORY,
      tags: form.tags.trim(),
      icon: form.icon || "",
    });
  };

  return (
    <form className="admin-panel space-y-3" onSubmit={submit}>
      <div className="admin-panel__title">基本信息</div>

      <div className="admin-filters">
        <label className="admin-field">
          <span>名称 *</span>
          <input
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="例如：B站/抖音视频下载器"
            maxLength={80}
          />
        </label>

        <label className="admin-field">
          <span>网址标识</span>
          <input
            value={form.slug}
            onChange={(e) => set("slug", e.target.value)}
            placeholder="留空自动生成 tool-{id}"
            maxLength={80}
          />
        </label>

        <label className="admin-field">
          <span>分类</span>
          <input
            value={form.category}
            onChange={(e) => set("category", e.target.value)}
            placeholder="视频 / 图片 / 文本…"
            maxLength={40}
            list="tool-categories"
          />
          <datalist id="tool-categories">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </label>

        <label className="admin-field">
          <span>类型 *</span>
          <select
            value={form.kind}
            onChange={(e) => set("kind", e.target.value as ToolKind)}
          >
            {(Object.keys(KIND_LABEL) as ToolKind[]).map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="admin-panel__title">卡片展示</div>

      <div className="admin-filters">
        <label className="admin-field">
          <span>图标</span>
          <select
            value={selectIcon}
            onChange={(e) => set("icon", e.target.value)}
          >
            {TOOL_ICON_NAMES.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>

        <div className="admin-field">
          <span>预览</span>
          <span className="tool-form__icon-preview">
            <MorphIcon icon={PreviewIcon} size={17} />
            <small>{selectIcon}</small>
          </span>
        </div>

        <label className="admin-field admin-field--grow">
          <span>一句话描述</span>
          <input
            value={form.summary}
            onChange={(e) => set("summary", e.target.value)}
            placeholder="列表里显示在名称下面"
            maxLength={200}
          />
        </label>
      </div>

      <label className="admin-field admin-field--grow">
        <span>标签（逗号分隔）</span>
        <input
          value={form.tags}
          onChange={(e) => set("tags", e.target.value)}
          placeholder="bilibili, 抖音, 下载"
          maxLength={200}
        />
      </label>

      <div className="admin-panel__title">目标地址</div>

      <label className="admin-field admin-field--grow">
        <span>地址 *</span>
        <input
          value={form.href}
          onChange={(e) => set("href", e.target.value)}
          placeholder={KIND_PLACEHOLDER[kind]}
          maxLength={500}
        />
        <small className="admin-muted">{KIND_HINT[kind]}</small>
      </label>

      <div className="admin-panel__title">状态</div>

      <div className="admin-filters">
        <label className="admin-field">
          <span>显示</span>
          <select
            value={form.is_visible ? "1" : "0"}
            onChange={(e) => set("is_visible", e.target.value === "1")}
          >
            <option value="1">上架</option>
            <option value="0">下架</option>
          </select>
        </label>

        <label className="admin-field">
          <span>排序（越小越前）</span>
          <input
            type="number"
            value={form.sort_order}
            onChange={(e) => set("sort_order", Number(e.target.value) || 0)}
          />
        </label>
      </div>

      {error && <p className="admin-error">{error}</p>}

      <div className="flex items-center gap-3">
        <button type="submit" className="admin-btn" disabled={!canSubmit}>
          {busy ? "保存中…" : submitText}
        </button>
        <button
          type="button"
          className="admin-btn admin-btn--ghost"
          onClick={onCancel}
          disabled={busy}
        >
          取消
        </button>
      </div>
    </form>
  );
}
