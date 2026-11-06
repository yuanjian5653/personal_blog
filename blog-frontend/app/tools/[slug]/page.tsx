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
/**
 * 返回工具列表。
 *
 * 用文章详情页同一套 .back-btn 效果（下划线从 0 撑满 + 箭头左移 + 文字染色），
 * 样式定义在 app/styles/ui-widgets.css，两处共用一份，改一处两边同步。
 *
 * 为什么用 <Link> 而不是文章页那样的 <button onClick={router.push}>：
 * 效果完全一致，但 <Link> 是真链接 —— 支持中键新开标签页、可被爬虫抓取。
 * 文本通过 --btn-text 传给 CSS 的伪元素（hover 时的那层高亮文字）。
 */
function BackToTools() {
  return (
    <Link
      href="/tools"
      className="back-btn tool-detail__back"
      style={
        {
          "--btn-text": '"返回工具列表"',
          "--primary-color": "var(--card-text-sub)",
          "--hovered-color": "var(--accent)",
        } as React.CSSProperties
      }
    >
      <svg
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        strokeWidth={2.5}
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M10 19l-7-7m0 0l7-7m-7 7h18"
        />
      </svg>
      <p>返回工具列表</p>
    </Link>
  );
}

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
        <BackToTools />
        <div className="tools-empty">
          {error === "工具不存在" ? "这个工具不存在或已下架" : error}
        </div>
      </div>
    );
  }

  if (!tool) {
    return (
      <div className="tool-detail">
        <BackToTools />
        <div className="tools-empty">正在加载…</div>
      </div>
    );
  }

  const Icon = resolveToolIcon(tool.icon);
  const tags = splitTags(tool.tags);
  const actionLabel = KIND_ACTION[tool.kind] ?? "打开";
  const ctaClass = "tool-detail__cta";

  return (
    <div className="tool-detail" data-color={tool.color ?? "default"}>
      <BackToTools />

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
