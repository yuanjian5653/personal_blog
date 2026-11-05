"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { MorphIcon } from "morphicons/react";

import {
  KIND_ACTION,
  KIND_LABEL,
  fetchToolBySlug,
  recordToolClick,
  splitTags,
  type ToolDetail,
} from "@/lib/tools";
import { resolveToolIcon } from "@/components/tools/icons";

/**
 * 工具详情页 /tools/[slug]
 *
 * 内容：图标 + 名称 + 一句话描述 + 分类/标签 + 主操作按钮 + Markdown 正文。
 *
 * 几个决定：
 *   · 直接 api.get，**不走缓存** —— 详情页是低频访问，改完工具应立刻看到新内容
 *   · 主按钮才是"使用工具"，点击计数记在这里（不是列表行）
 *   · 正文用 react-markdown + remarkGfm，与「关于」页同一套配置；
 *     不加 rehype-raw，所以 Markdown 里的原始 HTML 不会被渲染（防 XSS）
 *   · 正文容器复用文章页的 .prose-custom 样式，排版自动一致
 */
export default function ToolDetailPage() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug ?? "";

  const [tool, setTool] = useState<ToolDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;
    fetchToolBySlug(slug)
      .then((row) => setTool(row))
      .catch((e) => {
        setError(e instanceof Error ? e.message : "加载失败");
      });
  }, [slug]);

  const track = () => {
    if (tool) recordToolClick(tool.id);
  };

  if (error) {
    return (
      <div className="tool-detail">
        <Link href="/tools" className="tool-detail__back">
          ← 工具
        </Link>
        <div className="tools-empty">
          {error === "工具不存在" ? "这个工具不存在或已下架" : error}
        </div>
      </div>
    );
  }

  if (!tool) {
    return (
      <div className="tool-detail">
        <Link href="/tools" className="tool-detail__back">
          ← 工具
        </Link>
        <div className="tools-empty">正在加载…</div>
      </div>
    );
  }

  const Icon = resolveToolIcon(tool.icon);
  const tags = splitTags(tool.tags);
  const actionLabel = KIND_ACTION[tool.kind] ?? "打开";
  const ctaClass = "tool-detail__cta";

  return (
    <div className="tool-detail">
      <Link href="/tools" className="tool-detail__back">
        ← 工具
      </Link>

      <header className="tool-detail__head">
        <span className="tool-detail__icon" aria-hidden="true">
          <MorphIcon icon={Icon} size={24} />
        </span>
        <div className="tool-detail__heading">
          <h1 className="tool-detail__title">{tool.name}</h1>
          {tool.summary && (
            <p className="tool-detail__summary">{tool.summary}</p>
          )}
        </div>
      </header>

      <div className="tool-detail__meta">
        <span className="tool-detail__chip">{tool.category}</span>
        <span className="tool-detail__chip">{KIND_LABEL[tool.kind]}</span>
        {tags.map((tag) => (
          <span key={tag} className="tool-detail__tag">
            {tag}
          </span>
        ))}
      </div>

      {/* 主操作：站内页面用 Link（不刷新），文件下载与外部链接用 a */}
      {tool.kind === "page" ? (
        <Link href={tool.href} className={ctaClass} onClick={track}>
          {actionLabel} →
        </Link>
      ) : tool.kind === "app" && tool.href.startsWith("/") ? (
        <a href={tool.href} className={ctaClass} download onClick={track}>
          {actionLabel} ↓
        </a>
      ) : (
        <a
          href={tool.href}
          className={ctaClass}
          target="_blank"
          rel="noopener noreferrer"
          onClick={track}
        >
          {actionLabel} ↗
        </a>
      )}

      {tool.description && (
        <article className="tool-detail__body prose-custom">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {tool.description}
          </ReactMarkdown>
        </article>
      )}
    </div>
  );
}
