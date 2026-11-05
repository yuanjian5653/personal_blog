"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { invalidateCached } from "@/lib/cache";
import { createTool, fetchAllTools, emptyToolInput, type ToolInput } from "@/lib/tools";
import ToolForm from "@/components/tools/ToolForm";

/**
 * 新建工具。
 *
 * categories 从后台列表里取现有的分类名，用于表单的 datalist 提示 ——
 * 这样已有分类不会因为手打错别字分成两组。
 */
export default function AdminToolNewPage() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [categories, setCategories] = useState<string[]>([]);

  const loadCategories = useCallback(() => {
    fetchAllTools()
      .then((rows) =>
        setCategories(Array.from(new Set(rows.map((r) => r.category))).sort())
      )
      .catch(() => {
        // 取不到就退化成空列表，不影响新建
      });
  }, []);

  useEffect(() => {
    loadCategories();
  }, [loadCategories]);

  const submit = async (data: ToolInput) => {
    setBusy(true);
    setError(null);
    try {
      await createTool(data);
      // 前台缓存立即失效，回到工具页就能看到
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
        <h1 className="text-2xl font-bold">新建工具</h1>
        <button
          type="button"
          className="admin-btn admin-btn--ghost"
          onClick={() => router.push("/admin/tools")}
        >
          返回列表
        </button>
      </div>

      <ToolForm
        initial={emptyToolInput()}
        submitText="创建"
        busy={busy}
        error={error}
        onSubmit={submit}
        onCancel={() => router.push("/admin/tools")}
        categories={categories}
      />
    </div>
  );
}
