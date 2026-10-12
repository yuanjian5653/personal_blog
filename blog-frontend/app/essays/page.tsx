"use client";

import { useEffect, useMemo, useState } from "react";
import { MorphIcon } from "morphicons/react";
import { MessageSquare, Search } from "lucide";
import { api } from "@/lib/api";
import type { Essay } from "@/lib/types";
import EssayItem from "@/components/essays/EssayItem";
import EssayDetailModal from "@/components/essays/EssayDetailModal";

function dateKey(s: string): string {
  const d = new Date(s);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function dateLabel(s: string): string {
  const d = new Date(s);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

export default function EssaysPage() {
  const [essays, setEssays] = useState<Essay[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState("");
  const [selected, setSelected] = useState<Essay | null>(null);

  useEffect(() => {
    api
      .get<Essay[]>("/api/essays")
      .then(setEssays)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // 关键词筛选
  const filtered = useMemo(() => {
    if (!keyword.trim()) return essays;
    const kw = keyword.toLowerCase();
    return essays.filter(
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

  // 当前选中的 essay 被点赞后，同步列表里的数据
  const handleLikeUpdate = (id: number, likes: number) => {
    setEssays((prev) =>
      prev.map((e) => (e.id === id ? { ...e, likes } : e))
    );
    setSelected((prev) => (prev && prev.id === id ? { ...prev, likes } : prev));
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

              {/* 同日卡片列表 */}
              <div className="essays-group-list">
                {items.map((e) => (
                  <EssayItem
                    key={e.id}
                    essay={e}
                    onClick={() => setSelected(e)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 详情弹窗：key 保证切换到另一条说说时重新挂载（点赞数是组件内部状态） */}
      {selected && (
        <EssayDetailModal
          key={selected.id}
          essay={selected}
          onClose={() => setSelected(null)}
          onLikeUpdate={handleLikeUpdate}
        />
      )}
    </div>
  );
}