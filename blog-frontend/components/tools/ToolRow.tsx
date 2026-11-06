"use client";

import Link from "next/link";
import { MorphIcon } from "morphicons/react";

import { splitTags, type Tool } from "@/lib/tools";
import { resolveToolIcon } from "./icons";

/**
 * 工具列表的一行（朴素列表风：分隔线 + 图标 + 名称/说明 + 箭头）。
 *
 * 点击整行走**详情页**（/tools/{slug}）：详情页里才有正文和真正的
 * "打开/前往/下载"按钮。这样行本身是纯导航，不用处理三种 kind 的差别，
 * 点击计数也只在真正使用工具时（详情页按钮）才记，语义更准。
 */
export default function ToolRow({ tool }: { tool: Tool }) {
  const Icon = resolveToolIcon(tool.icon);
  const tags = splitTags(tool.tags);
  const isApp = tool.kind === "app";

  return (
    <Link
      href={`/tools/${tool.slug}`}
      className="tool-row"
      /* 配色交给 CSS 处理（见 tools.css 的 [data-color] 规则），
         这样不必在 JS 里拼颜色，也避免主题切换时对不上 */
      data-color={tool.color ?? "default"}
    >
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
        →
      </span>
    </Link>
  );
}
