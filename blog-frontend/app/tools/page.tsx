"use client";

import { useMemo } from "react";

import { useCachedFetch } from "@/lib/useCachedFetch";
import { fetchTools, type Tool } from "@/lib/tools";
import ToolRow from "@/components/tools/ToolRow";

/**
 * 工具页（朴素列表风：分组 + 分隔线，不做卡片）。
 *
 * 按 category 分组；组的先后顺序 = 各组第一项在 sort_order 里的位置，
 * 所以在后台把某个工具调到最前，它所在的分类也会跟着到最前。
 *
 * 缓存键是 "/api/tools" —— 与后台保存后调用的 invalidateCached("/api/tools")
 * 是同一个 key，所以改完工具回到前台不用等 60 秒缓存过期。
 */
export default function ToolsPage() {
  const { data, loading } = useCachedFetch<Tool[]>(
    "/api/tools",
    fetchTools,
    60_000
  );

  const groups = useMemo(() => {
    const map = new Map<string, Tool[]>();
    for (const tool of data ?? []) {
      const key = tool.category || "其他";
      const list = map.get(key);
      if (list) list.push(tool);
      else map.set(key, [tool]);
    }
    return Array.from(map.entries());
  }, [data]);

  return (
    <div className="tools-page">
      <header className="tools-hero">
        <h1 className="tools-hero__title">工具</h1>
        <p className="tools-hero__sub">一些自用的小工具</p>
      </header>

      {loading ? (
        <div className="tools-empty">正在加载…</div>
      ) : groups.length === 0 ? (
        <div className="tools-empty">还没有工具</div>
      ) : (
        groups.map(([category, list]) => (
          <section className="tools-group" key={category}>
            <h2 className="tools-group__title">{category}</h2>
            <ul className="tools-list">
              {list.map((tool) => (
                <li className="tools-list__item" key={tool.id}>
                  <ToolRow tool={tool} />
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
