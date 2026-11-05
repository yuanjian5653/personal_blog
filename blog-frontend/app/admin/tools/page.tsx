"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

import { invalidateCached } from "@/lib/cache";
import {
  KIND_LABEL,
  deleteTool,
  fetchAllTools,
  reorderTools,
  updateTool,
  type Tool,
} from "@/lib/tools";
import { resolveToolIcon } from "@/components/tools/icons";
import { MorphIcon } from "morphicons/react";

/**
 * 后台工具列表：排序（↑↓）/ 上下架 / 编辑 / 删除。
 *
 * 排序用 ↑↓ 按钮而不是拖拽 —— 项目里没有拖拽库，为一页功能引一个依赖不值得；
 * 每次改序都提交整组 (id, sort_order)，后端一次事务写完，不会出现中间态。
 *
 * 任何写操作成功后都调 invalidateCached("/api/tools")，
 * 前台工具页的缓存立刻失效，不用等 60 秒。
 */
export default function AdminToolsPage() {
  const [tools, setTools] = useState<Tool[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 用 .then 链而不是 async/await：effect 里同步调用 async 函数会命中
  // react-hooks/set-state-in-effect（同步 setState）。项目里其它后台页
  // （友链、项目）也是这个写法。
  const load = useCallback(() => {
    fetchAllTools()
      .then((rows) => {
        setTools(rows);
        setError(null);
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : "加载失败");
        setTools([]);
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const flash = (msg: string) => {
    setOkMsg(msg);
    window.setTimeout(() => setOkMsg(null), 2000);
  };

  /** 上移 / 下移：交换两条的 sort_order，然后把整组顺序提交上去 */
  const move = async (index: number, delta: number) => {
    if (!tools || busy) return;
    const target = index + delta;
    if (target < 0 || target >= tools.length) return;

    const next = [...tools];
    [next[index], next[target]] = [next[target], next[index]];

    setBusy(true);
    try {
      await reorderTools(
        next.map((t, i) => ({ id: t.id, sort_order: i }))
      );
      setTools(next);
      invalidateCached("/api/tools");
      flash("顺序已更新");
    } catch (e) {
      setError(e instanceof Error ? e.message : "排序失败");
    } finally {
      setBusy(false);
    }
  };

  const toggleVisible = async (tool: Tool) => {
    setBusy(true);
    try {
      const updated = await updateTool(tool.id, {
        is_visible: !tool.is_visible,
      });
      setTools((prev) =>
        prev ? prev.map((t) => (t.id === updated.id ? updated : t)) : prev
      );
      invalidateCached("/api/tools");
      flash(updated.is_visible ? "已上架" : "已下架");
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (tool: Tool) => {
    if (!window.confirm(`确定删除「${tool.name}」？此操作不可撤销。`)) return;
    setBusy(true);
    try {
      await deleteTool(tool.id);
      setTools((prev) => (prev ? prev.filter((t) => t.id !== tool.id) : prev));
      invalidateCached("/api/tools");
      flash("已删除");
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">工具管理</h1>
          {tools && <span className="admin-muted text-xs">共 {tools.length} 条</span>}
        </div>
        <Link href="/admin/tools/new" className="admin-btn">
          + 新建工具
        </Link>
      </div>

      {okMsg && <p className="admin-ok">{okMsg}</p>}
      {error && <p className="admin-error">{error}</p>}

      <div className="admin-panel admin-panel--flush">
        {tools === null ? (
          <p className="admin-muted p-6">加载中…</p>
        ) : tools.length === 0 ? (
          <p className="admin-muted p-6">
            还没有工具，点右上角「新建工具」添加一个。
          </p>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th style={{ width: 84 }}>排序</th>
                <th>名称 / 说明</th>
                <th>分类</th>
                <th>类型</th>
                <th>点击</th>
                <th>状态</th>
                <th style={{ width: 170 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {tools.map((tool, index) => {
                const Icon = resolveToolIcon(tool.icon);
                return (
                  <tr
                    key={tool.id}
                    style={tool.is_visible ? undefined : { opacity: 0.55 }}
                  >
                    <td>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          className="admin-link"
                          disabled={index === 0 || busy}
                          onClick={() => move(index, -1)}
                          title="上移"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className="admin-link"
                          disabled={index === tools.length - 1 || busy}
                          onClick={() => move(index, 1)}
                          title="下移"
                        >
                          ↓
                        </button>
                      </div>
                    </td>

                    <td>
                      <div className="admin-user">
                        <span className="admin-avatar admin-avatar--fallback">
                          <MorphIcon icon={Icon} size={14} />
                        </span>
                        <div>
                          <span className="admin-user__name">{tool.name}</span>
                          <div className="admin-muted text-xs">
                            {tool.summary || "（无描述）"}
                          </div>
                        </div>
                      </div>
                    </td>

                    <td>{tool.category}</td>
                    <td>{KIND_LABEL[tool.kind] ?? tool.kind}</td>
                    <td className="tabular-nums">{tool.click_count}</td>
                    <td>
                      <span className={tool.is_visible ? "admin-badge" : "admin-badge admin-muted"}>
                        {tool.is_visible ? "已上架" : "已下架"}
                      </span>
                    </td>
                    <td>
                      <div className="flex items-center gap-3">
                        <Link
                          href={`/admin/tools/${tool.id}`}
                          className="admin-link"
                        >
                          编辑
                        </Link>
                        <button
                          type="button"
                          className="admin-link"
                          disabled={busy}
                          onClick={() => toggleVisible(tool)}
                        >
                          {tool.is_visible ? "下架" : "上架"}
                        </button>
                        <button
                          type="button"
                          className="admin-link admin-link--danger"
                          disabled={busy}
                          onClick={() => remove(tool)}
                        >
                          删除
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <p className="admin-muted text-xs">
        提示：前台地址是 <code>/tools</code>；保存后前台缓存会立即刷新。
      </p>
    </div>
  );
}
