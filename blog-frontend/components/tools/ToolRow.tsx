"use client";

import Link from "next/link";
import { MorphIcon } from "morphicons/react";

import { recordToolClick, splitTags, type Tool } from "@/lib/tools";
import { resolveToolIcon } from "./icons";

/**
 * 工具列表的一行（朴素列表风：分隔线 + 图标 + 名称/说明 + 箭头）。
 *
 * 三种 kind 的点击行为：
 *   page  站内跳转（用 next/link，不刷新页面）
 *   app   下载（站内路径加 download；外链则新窗口）
 *   link  新窗口打开
 *
 * 点击时上报计数，用 sendBeacon 保证"跳走之后请求也能发出去"。
 */
export default function ToolRow({ tool }: { tool: Tool }) {
  const Icon = resolveToolIcon(tool.icon);
  const tags = splitTags(tool.tags);
  const isPage = tool.kind === "page";
  const isApp = tool.kind === "app";
  const isLocalFile = isApp && tool.href.startsWith("/");

  const handleClick = () => recordToolClick(tool.id);

  const content = (
    <>
      <span className="tool-row__icon" aria-hidden="true">
        <MorphIcon icon={Icon} size={17} />
      </span>

      <span className="tool-row__main">
        <span className="tool-row__title">
          <span className="tool-row__name">{tool.name}</span>
          {isApp && <span className="tool-row__badge">可下载</span>}
        </span>

        {tool.summary && (
          <span className="tool-row__summary">{tool.summary}</span>
        )}

        {tags.length > 0 && (
          <span className="tool-row__tags">
            {tags.map((tag) => (
              <span key={tag} className="tool-row__tag">
                {tag}
              </span>
            ))}
          </span>
        )}
      </span>

      <span className="tool-row__arrow" aria-hidden="true">
        {isApp ? "↓" : "→"}
      </span>
    </>
  );

  if (isPage) {
    return (
      <Link href={tool.href} className="tool-row" onClick={handleClick}>
        {content}
      </Link>
    );
  }

  // 站内文件用 download，外链走新窗口
  if (isLocalFile) {
    return (
      <a href={tool.href} className="tool-row" download onClick={handleClick}>
        {content}
      </a>
    );
  }

  return (
    <a
      href={tool.href}
      className="tool-row"
      target="_blank"
      rel="noopener noreferrer"
      onClick={handleClick}
    >
      {content}
    </a>
  );
}
