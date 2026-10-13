"use client";

import { useEffect, useMemo, useState } from "react";
import { MorphIcon } from "morphicons/react";
import { MessageSquare, Search } from "lucide";
import { api } from "@/lib/api";
import type { Essay } from "@/lib/types";
import EssayItem from "@/components/essays/EssayItem";

function dateKey(s: string): string {
  const d = new Date(s);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function dateLabel(s: string): string {
  const d = new Date(s);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

export default function EssaysPage() {
  // null = 尚未加载完；loading 由它派生，避免在 effect 里同步 setState
  const [essays, setEssays] = useState<Essay[] | null>(null);
  const loading = essays === null;
  const [keyword, setKeyword] = useState("");
  // 已展开的说说 id（同一天里可以同时展开多条）
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    let cancelled = false;
    api
      .get<Essay[]>("/api/essays")
      .then((list) => {
        if (!cancelled) setEssays(list);
      })
      .catch(() => {
        if (!cancelled) setEssays([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 关键词筛选
  const filtered = useMemo(() => {
    const list = essays ?? [];
    if (!keyword.trim()) return list;
    const kw = keyword.toLowerCase();
    return list.filter(
      (e) =>
        (e.content || "").toLowerCase().includes(kw) ||
        (e.title || "").toLowerCase().includes(kw)
    );
  }, [essays, keyword]);

  // 按日期分组
  const grouped = useMemo(() => {
    const map = new Map<string, Essay[]>();
    for (const e of filtered) {
      const key = dateKey(e.created_at);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(e);
    }
    // 按日期倒序
    return Array.from(map.entries()).sort((a, b) => {
      const [ya, ma, da] = a[0].split("-").map(Number);
      const [yb, mb, db] = b[0].split("-").map(Number);
      return (
        new Date(yb, mb - 1, db).getTime() - new Date(ya, ma - 1, da).getTime()
      );
    });
  }, [filtered]);

  // 点赞后同步列表数据（展开视图里的点赞按钮会回调）
  const handleLikeUpdate = (id: number, likes: number) => {
    setEssays((prev) =>
      (prev ?? []).map((e) => (e.id === id ? { ...e, likes } : e))
    );
  };

  const toggleExpand = (id: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="max-w-3xl mx-auto pt-2">
      {/* 标题 */}
      <div className="essays-hero">
        <div className="essays-hero-title-row">
          <div className="essays-hero-icon">
            <MorphIcon icon={MessageSquare} size={26} />
          </div>
          <div>
            <h1 className="essays-hero-title">说说</h1>
            <p className="essays-hero-sub">记录生活中的小确幸</p>
          </div>
        </div>

        <div className="archive-search essays-search">
          <MorphIcon
            icon={Search}
            size={16}
            style={{ color: "var(--text-secondary)", flexShrink: 0 }}
          />
          <input
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索说说..."
          />
          {keyword && (
            <button
              onClick={() => setKeyword("")}
              className="text-xs"
              style={{ color: "var(--text-secondary)" }}
            >
              ×
            </button>
          )}
        </div>
      </div>

      {/* 内容 */}
      {loading ? (
        <div className="archive-empty">加载中...</div>
      ) : grouped.length === 0 ? (
        <div className="archive-empty">
          {keyword ? "没有匹配的说说" : "还没有说说"}
        </div>
      ) : (
        <div className="essays-timeline">
          {grouped.map(([key, items]) => (
            <div key={key} className="essays-group">
              {/* 日期头 */}
              <div className="essays-group-head">
                <span className="essays-group-date">
                  {dateLabel(items[0].created_at)}
                </span>
                <span className="essays-group-count">{items.length} 条</span>
                <span className="essays-group-line" />
              </div>

              {/* 同一天的说说叠成一摞纸条，点开展开详细内容 */}
              <div className="essays-group-list">
                {items.map((e, i) => {
                  // 上面任意一条展开时，本条不再向上叠压（否则会盖住展开内容）
                  const prevExpanded = items
                    .slice(0, i)
                    .some((prev) => expandedIds.has(prev.id));
                  return (
                    <EssayItem
                      key={e.id}
                      essay={e}
                      index={i}
                      expanded={expandedIds.has(e.id)}
                      prevExpanded={prevExpanded}
                      onToggle={() => toggleExpand(e.id)}
                      onLikeUpdate={handleLikeUpdate}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}