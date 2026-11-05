"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";

import { invalidateCached } from "@/lib/cache";
import {
  fetchAllTools,
  fetchTool,
  toolToInput,
  updateTool,
  type Tool,
  type ToolInput,
} from "@/lib/tools";
import ToolForm from "@/components/tools/ToolForm";

/**
 * 编辑工具。
 *
 * 用 key={tool.id} 给 ToolForm 强制重建：切换工具时表单内部状态自动重置，
 * 不需要在表单里写"initial 变了就 setState"的 effect
 * （那种写法既容易漏依赖，也会触发 react-hooks/set-state-in-effect）。
 */
export default function AdminToolEditPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = Number(params?.id);

  const [tool, setTool] = useState<Tool | null>(null);
  const [categories, setCategories] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // id 是否合法在**渲染期**就算出来，不放到 effect 里 ——
  // 在 effect 里同步 setState 会命中 react-hooks/set-state-in-effect。
  const validId = Number.isFinite(id) && id > 0;

  const load = useCallback(() => {
    Promise.all([fetchTool(id), fetchAllTools()])
      .then(([row, all]) => {
        setTool(row);
        setCategories(Array.from(new Set(all.map((r) => r.category))).sort());
        setLoadError(null);
      })
      .catch((e) => {
        setLoadError(e instanceof Error ? e.message : "加载失败");
      });
  }, [id]);

  useEffect(() => {
    if (!validId) return;
    load();
  }, [validId, load]);

  const submit = async (data: ToolInput) => {
    if (!tool) return;
    setBusy(true);
    setError(null);
    try {
      await updateTool(tool.id, data);
      invalidateCached("/api/tools");
      router.push("/admin/tools");
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">编辑工具</h1>
          {tool && <span className="admin-muted text-xs">#{tool.id} · {tool.slug}</span>}
        </div>
        <button
          type="button"
          className="admin-btn admin-btn--ghost"
          onClick={() => router.push("/admin/tools")}
        >
          返回列表
        </button>
      </div>

      {!validId ? (
        <p className="admin-error">地址里的工具 ID 不合法</p>
      ) : loadError ? (
        <p className="admin-error">{loadError}</p>
      ) : tool === null ? (
        <p className="admin-muted">加载中…</p>
      ) : (
        <ToolForm
          key={tool.id}
          initial={toolToInput(tool)}
          submitText="保存修改"
          busy={busy}
          error={error}
          onSubmit={submit}
          onCancel={() => router.push("/admin/tools")}
          categories={categories}
        />
      )}
    </div>
  );
}
