"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  KIND_HINT,
  KIND_LABEL,
  TRANSITION_LABEL,
  createEgg,
  deleteEgg,
  eggToInput,
  emptyEggInput,
  fetchEggs,
  updateEgg,
  uploadWallpaper,
  type EasterEggInput,
  type EasterEggRow,
  type EggKind,
  type EggTransition,
} from "@/lib/easterEggAdmin";

/**
 * 后台 · 暗号彩蛋
 *
 * 一个页面管完：新建 / 编辑 / 启停 / 删除 / 上传动态壁纸。
 * 暗号支持改名——改完旧暗号立刻失效（因为校验是查库的）。
 */
export default function AdminEasterEggsPage() {
  const [rows, setRows] = useState<EasterEggRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 表单：null = 没在编辑
  const [form, setForm] = useState<EasterEggInput | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(() => {
    fetchEggs()
      .then((d) => {
        setRows(d);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "加载失败"));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const flash = (msg: string) => {
    setOkMsg(msg);
    window.setTimeout(() => setOkMsg(null), 2500);
  };

  const set = <K extends keyof EasterEggInput>(
    key: K,
    value: EasterEggInput[K]
  ) => setForm((prev) => (prev ? { ...prev, [key]: value } : prev));

  const openNew = () => {
    setEditingId(null);
    setForm(emptyEggInput());
  };

  const openEdit = (row: EasterEggRow) => {
    setEditingId(row.id);
    setForm(eggToInput(row));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    if (!form.code.trim() || !form.name.trim()) {
      setError("暗号和名称都必须填");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (editingId === null) {
        await createEgg(form);
        flash("已新建");
      } else {
        await updateEgg(editingId, form);
        flash("已保存");
      }
      setForm(null);
      setEditingId(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };

  const toggleEnabled = async (row: EasterEggRow) => {
    setBusy(true);
    try {
      await updateEgg(row.id, { is_enabled: !row.is_enabled });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (row: EasterEggRow) => {
    if (!window.confirm(`删除暗号「${row.code}」？删除后这个暗号立刻失效。`)) {
      return;
    }
    setBusy(true);
    try {
      await deleteEgg(row.id);
      flash("已删除");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败");
    } finally {
      setBusy(false);
    }
  };

  const onPickFile = async (file: File | null) => {
    if (!file || !form) return;
    setBusy(true);
    setError(null);
    try {
      const res = await uploadWallpaper(file);
      set("asset_path", res.url);
      set("asset_kind", res.asset_kind);
      flash(
        res.warning
          ? `已上传。注意：${res.warning}`
          : `已上传（${(res.size / 1024).toFixed(0)} KB）`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "上传失败");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">暗号彩蛋</h1>
          <span className="admin-muted text-xs">
            共 {rows?.length ?? 0} 个 · 前台输入暗号解锁
          </span>
        </div>
        <button type="button" className="admin-btn" onClick={openNew} disabled={busy}>
          新建暗号
        </button>
      </div>

      <p className="admin-muted text-xs">
        前台**拿不到**这个列表（校验接口只回“对不对”），所以暗号是真秘密。
        用户随时可以输入「关闭」还原所有效果。
      </p>

      {okMsg && <p className="admin-ok">{okMsg}</p>}
      {error && <p className="admin-error">{error}</p>}

      {/* 编辑表单 */}
      {form && (
        <form className="admin-panel space-y-3" onSubmit={submit}>
          <div className="admin-panel__title">
            {editingId === null ? "新建暗号" : `编辑 #${editingId}`}
          </div>

          <div className="admin-filters">
            <label className="admin-field">
              <span>暗号 *</span>
              <input
                value={form.code}
                onChange={(e) => set("code", e.target.value)}
                placeholder="例如：星空"
                maxLength={60}
                disabled={busy}
              />
            </label>

            <label className="admin-field">
              <span>展示名 *</span>
              <input
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="例如：动态背景"
                maxLength={60}
                disabled={busy}
              />
            </label>

            <label className="admin-field">
              <span>类型</span>
              <select
                value={form.kind}
                onChange={(e) => set("kind", e.target.value as EggKind)}
                disabled={busy}
              >
                {(Object.keys(KIND_LABEL) as EggKind[]).map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABEL[k]}
                  </option>
                ))}
              </select>
            </label>

            <label className="admin-field">
              <span>切换动效</span>
              <select
                value={form.transition}
                onChange={(e) =>
                  set("transition", e.target.value as EggTransition)
                }
                disabled={busy}
              >
                {(Object.keys(TRANSITION_LABEL) as EggTransition[]).map((t) => (
                  <option key={t} value={t}>
                    {TRANSITION_LABEL[t]}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <p className="admin-muted text-xs">{KIND_HINT[form.kind]}</p>

          <label className="admin-field admin-field--grow">
            <span>解锁提示</span>
            <input
              value={form.hint}
              onChange={(e) => set("hint", e.target.value)}
              placeholder="用户在首页输入正确暗号后看到的这句话"
              disabled={busy}
            />
          </label>

          {/* 动态壁纸（只有 background 类型才有意义） */}
          {form.kind === "background" && (
            <div className="admin-field admin-field--grow">
              <span>动态壁纸（mp4 / webm / gif / webp，≤ 8 MB，建议 3 MB 内）</span>
              <div className="flex items-center gap-3 flex-wrap">
                <input
                  ref={fileRef}
                  type="file"
                  accept=".mp4,.webm,.gif,.webp,video/mp4,video/webm,image/gif,image/webp"
                  onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
                  disabled={busy}
                  className="text-xs"
                />
                {form.asset_path && (
                  <>
                    <span className="admin-muted text-xs">
                      {form.asset_kind === "video" ? "视频" : "动图"} ·{" "}
                      {form.asset_path}
                    </span>
                    <button
                      type="button"
                      className="admin-link admin-link--danger"
                      onClick={() => {
                        set("asset_path", "");
                        set("asset_kind", null);
                      }}
                      disabled={busy}
                    >
                      移除
                    </button>
                  </>
                )}
              </div>
              <small className="admin-muted">
                **不上传壁纸就什么都不会显示** —— 这个暗号解锁后只会提示一句，
                背景不变。服务器出站只有 1 Mbps，壁纸越大访客加载越慢。
              </small>
            </div>
          )}

          <div className="flex items-center gap-4">
            <label className="admin-field" style={{ flexDirection: "row" }}>
              <input
                type="checkbox"
                checked={form.is_enabled}
                onChange={(e) => set("is_enabled", e.target.checked)}
                disabled={busy}
              />
              <span>启用（关闭后这个暗号立即失效）</span>
            </label>

            <label className="admin-field" style={{ flexDirection: "row" }}>
              <span>排序</span>
              <input
                type="number"
                value={form.sort_order}
                onChange={(e) => set("sort_order", Number(e.target.value) || 0)}
                style={{ width: 80 }}
                disabled={busy}
              />
            </label>

            <div className="flex items-center gap-3 ml-auto">
              <button type="submit" className="admin-btn" disabled={busy}>
                {editingId === null ? "创建" : "保存"}
              </button>
              <button
                type="button"
                className="admin-btn admin-btn--ghost"
                onClick={() => {
                  setForm(null);
                  setEditingId(null);
                }}
                disabled={busy}
              >
                取消
              </button>
            </div>
          </div>
        </form>
      )}

      {/* 列表 */}
      <div className="admin-panel admin-panel--flush">
        {rows === null ? (
          <p className="admin-muted p-6">加载中…</p>
        ) : rows.length === 0 ? (
          <p className="admin-muted p-6">
            还没有暗号。点右上角「新建暗号」加一个，前台首页输入它就能解锁。
          </p>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>暗号</th>
                <th>名称</th>
                <th>类型</th>
                <th>壁纸</th>
                <th>动效</th>
                <th>状态</th>
                <th style={{ width: 150 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <code className="admin-code">{row.code}</code>
                  </td>
                  <td>
                    <div className="admin-user">
                      <span className="admin-user__name">{row.name}</span>
                      {row.hint && (
                        <span className="admin-muted text-xs">{row.hint}</span>
                      )}
                    </div>
                  </td>
                  <td>{KIND_LABEL[row.kind] ?? row.kind}</td>
                  <td className="admin-muted text-xs">
                    {row.asset_path ? (
                      row.asset_kind === "video" ? (
                        "视频"
                      ) : (
                        "动图"
                      )
                    ) : row.kind === "background" ? (
                      <span title="没上传壁纸：这个暗号解锁后背景不会变">未上传</span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="admin-muted text-xs">
                    {TRANSITION_LABEL[row.transition] ?? row.transition}
                  </td>
                  <td>
                    <span
                      className={`admin-badge${row.is_enabled ? "" : " admin-badge--muted"}`}
                    >
                      {row.is_enabled ? "启用" : "已关闭"}
                    </span>
                  </td>
                  <td>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        className="admin-link"
                        onClick={() => openEdit(row)}
                        disabled={busy}
                      >
                        编辑
                      </button>
                      <button
                        type="button"
                        className="admin-link"
                        onClick={() => toggleEnabled(row)}
                        disabled={busy}
                      >
                        {row.is_enabled ? "关闭" : "启用"}
                      </button>
                      <button
                        type="button"
                        className="admin-link admin-link--danger"
                        onClick={() => remove(row)}
                        disabled={busy}
                      >
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="admin-muted text-xs">
        提示：暗号比较会忽略空格和大小写，所以「星空」和「 星空 」是同一个。
        用户在首页输入暗号时如果命中，会立刻看到切换动效。
      </p>
    </div>
  );
}
