"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { MorphIcon } from "morphicons/react";
import { Check, ImageOff, Loader2, RefreshCw, Trash2, TriangleAlert } from "lucide";

import { api } from "@/lib/api";
import { withApiBase } from "@/lib/api";

/**
 * 图库管理
 *
 * 上传是"只进不出"的：换封面、删文章、改头像之后旧图还留在磁盘上。
 * 这个页面把 photos 目录里的每张图摊开，标出**有没有被引用**，
 * 让你看清哪些能删。
 *
 * 引用检测在后端做（扫全库的图片字段），原则是**宁可漏报、绝不误删**：
 * 只要有任何一处引用，就不会被当成孤儿。
 */

interface GalleryItem {
  name: string;
  url: string;
  size: number;
  modified: number;
  referenced: boolean;
  thumb: string | null;
}

interface Stats {
  total: number;
  total_size: number;
  orphans: number;
  orphan_size: number;
  referenced: number;
}

type Filter = "all" | "orphan" | "used";

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function fmtDate(ts: number): string {
  const d = new Date(ts * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function AdminGalleryPage() {
  const [items, setItems] = useState<GalleryItem[] | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    Promise.all([
      api.get<GalleryItem[]>("/api/admin/gallery"),
      api.get<Stats>("/api/admin/gallery/stats"),
    ])
      .then(([list, s]) => {
        setItems(list);
        setStats(s);
        // 清错误放在**异步回调**里：在 effect 里同步 setState
        // 会触发连锁渲染，eslint 的 react-hooks/set-state-in-effect 会拦
        setError(null);
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : "加载失败");
        setItems([]);
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const shown = useMemo(() => {
    if (!items) return [];
    if (filter === "orphan") return items.filter((i) => !i.referenced);
    if (filter === "used") return items.filter((i) => i.referenced);
    return items;
  }, [items, filter]);

  const toggle = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const selectAllOrphans = () => {
    if (!items) return;
    setSelected(new Set(items.filter((i) => !i.referenced).map((i) => i.name)));
    setFilter("orphan");
  };

  const doCleanup = async (names: string[] | null, dryRun: boolean) => {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const r = await api.post<{ deleted: string[]; skipped: string[]; freed: number }>(
        "/api/admin/gallery/cleanup",
        { names, dry_run: dryRun }
      );
      if (dryRun) {
        setMsg(
          `预演：将删除 ${r.deleted.length} 张，腾出 ${fmtSize(r.freed)}` +
            (r.skipped.length ? `，跳过 ${r.skipped.length} 张（仍被引用或不可删）` : "")
        );
      } else {
        setMsg(
          `已删除 ${r.deleted.length} 张，腾出 ${fmtSize(r.freed)}` +
            (r.skipped.length ? `，跳过 ${r.skipped.length} 张` : "")
        );
        setSelected(new Set());
        load();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async (names: string[] | null) => {
    // 先预演，把"要删几张、腾多少"摆在用户面前再确认
    setBusy(true);
    try {
      const preview = await api.post<{ deleted: string[]; freed: number }>(
        "/api/admin/gallery/cleanup",
        { names, dry_run: true }
      );
      setBusy(false);
      if (preview.deleted.length === 0) {
        setMsg("没有可删除的图片（都被引用了）");
        return;
      }
      const ok = window.confirm(
        `将删除 ${preview.deleted.length} 张图片，腾出 ${fmtSize(preview.freed)}。\n` +
          `被引用的图片会自动跳过，不会误删。\n\n确定继续？`
      );
      if (!ok) return;
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error ? e.message : "预演失败");
      return;
    }
    await doCleanup(names, false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold">图库管理</h1>
        <button
          type="button"
          className="admin-btn admin-btn--ghost"
          onClick={load}
          disabled={busy}
        >
          <MorphIcon icon={RefreshCw} size={14} /> 刷新
        </button>
      </div>

      {/* 统计 */}
      {stats && (
        <div className="admin-filters">
          <div className="admin-panel admin-panel--flush" style={{ padding: "0.75rem 1rem" }}>
            <div className="admin-muted text-xs">图片总数</div>
            <div className="text-lg font-semibold">{stats.total}</div>
          </div>
          <div className="admin-panel admin-panel--flush" style={{ padding: "0.75rem 1rem" }}>
            <div className="admin-muted text-xs">占用空间</div>
            <div className="text-lg font-semibold">{fmtSize(stats.total_size)}</div>
          </div>
          <div className="admin-panel admin-panel--flush" style={{ padding: "0.75rem 1rem" }}>
            <div className="admin-muted text-xs">仍被引用</div>
            <div className="text-lg font-semibold">{stats.referenced}</div>
          </div>
          <div className="admin-panel admin-panel--flush" style={{ padding: "0.75rem 1rem" }}>
            <div className="admin-muted text-xs">
              <MorphIcon icon={TriangleAlert} size={12} /> 没人用（可清理）
            </div>
            <div className="text-lg font-semibold">
              {stats.orphans}
              <span className="admin-muted text-xs" style={{ marginLeft: 6 }}>
                {fmtSize(stats.orphan_size)}
              </span>
            </div>
          </div>
        </div>
      )}

      {error && <p className="admin-error">{error}</p>}
      {msg && <p className="admin-ok">{msg}</p>}

      {/* 操作栏 */}
      <div className="admin-actions">
        <button
          type="button"
          className={filter === "all" ? "admin-btn" : "admin-btn admin-btn--ghost"}
          onClick={() => setFilter("all")}
        >
          全部 {items ? `(${items.length})` : ""}
        </button>
        <button
          type="button"
          className={filter === "orphan" ? "admin-btn" : "admin-btn admin-btn--ghost"}
          onClick={() => setFilter("orphan")}
        >
          没人用 {stats ? `(${stats.orphans})` : ""}
        </button>
        <button
          type="button"
          className={filter === "used" ? "admin-btn" : "admin-btn admin-btn--ghost"}
          onClick={() => setFilter("used")}
        >
          被引用 {stats ? `(${stats.referenced})` : ""}
        </button>

        <span style={{ flex: 1 }} />

        <button type="button" className="admin-link" onClick={selectAllOrphans}>
          选中全部没人用的
        </button>
        <button
          type="button"
          className="admin-btn admin-btn--ghost"
          disabled={busy || selected.size === 0}
          onClick={() => void confirmDelete([...selected])}
        >
          <MorphIcon icon={Trash2} size={14} /> 删除选中 ({selected.size})
        </button>
        <button
          type="button"
          className="admin-btn"
          disabled={busy || !stats || stats.orphans === 0}
          onClick={() => void confirmDelete(null)}
        >
          <MorphIcon icon={Trash2} size={14} /> 清理全部没人用的
        </button>
      </div>

      {/* 网格 */}
      {items === null ? (
        <p className="admin-muted">
          <MorphIcon icon={Loader2} size={14} /> 加载中…
        </p>
      ) : shown.length === 0 ? (
        <p className="admin-muted">
          <MorphIcon icon={ImageOff} size={14} /> 这个筛选下没有图片
        </p>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
            gap: 12,
          }}
        >
          {shown.map((item) => {
            const isSel = selected.has(item.name);
            return (
              <div
                key={item.name}
                className="admin-panel admin-panel--flush"
                onClick={() => toggle(item.name)}
                style={{
                  cursor: "pointer",
                  padding: 8,
                  position: "relative",
                  outline: isSel ? "2px solid var(--accent, #6ea8fe)" : "none",
                  opacity: item.referenced ? 1 : 0.92,
                }}
                title={`${item.name}\n${fmtSize(item.size)} · ${fmtDate(item.modified)}\n${item.referenced ? "仍被引用（不会被删）" : "没人引用"}`}
              >
                <div
                  style={{
                    position: "relative",
                    width: "100%",
                    aspectRatio: "4 / 3",
                    overflow: "hidden",
                    borderRadius: 6,
                    background: "rgba(255,255,255,0.04)",
                  }}
                >
                  <img
                    loading="lazy"
                    decoding="async"
                    src={withApiBase(item.thumb || item.url)}
                    alt={item.name}
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  />
                  {isSel && (
                    <span
                      style={{
                        position: "absolute",
                        top: 4,
                        right: 4,
                        background: "var(--accent, #6ea8fe)",
                        color: "#fff",
                        borderRadius: 9999,
                        padding: 2,
                        display: "flex",
                      }}
                    >
                      <MorphIcon icon={Check} size={12} />
                    </span>
                  )}
                  {!item.referenced && (
                    <span
                      className="admin-badge admin-badge--rejected"
                      style={{ position: "absolute", bottom: 4, left: 4 }}
                    >
                      没人用
                    </span>
                  )}
                </div>
                <div className="admin-muted text-xs" style={{ marginTop: 6 }}>
                  {fmtSize(item.size)}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="admin-muted text-xs">
        「没人用」= 全库没有任何地方引用它（文章封面/正文、相册照片、生活图片、
        头像、背景图、主题背景、歌单封面等都会检查）。
        被引用的图片即使手动选中也会被跳过，不会删掉正在用的图。
      </p>
    </div>
  );
}
