"use client";

import { api } from "@/lib/api";
import { Fragment, useCallback, useEffect, useState } from "react";
import { MorphIcon } from "morphicons/react";
import { RefreshCw } from "lucide";

import {
  KIND_ORDER,
  PendingItem,
  ReviewKind,
  ReviewQueue,
  decide,
  editHref,
  fetchQueue,
} from "@/lib/review";
import { resolveImageUrl } from "@/lib/url";

/**
 * 内容审核队列（仅管理员）。
 *
 * 样式遵循后台既有页面的约定（与 members / friends / easter-eggs 一致）：
 * Tailwind 打骨架 + .admin-* 做局部样式，label 文字包在 <span> 里。
 */
const KIND_LABEL: Record<ReviewKind, string> = {
  article: "文章",
  essay: "说说",
  life: "动态",
  album: "图片组",
  photo: "图片",
  friendlink: "友链",
};

/**
 * 展开后的详情面板。
 *
 * 各类型字段不一样，这里统一成：正文（等宽换行）+ 图片网格 + 友链网址。
 * 用 <pre> 而不是 Markdown 渲染：审核要的是"内容写了什么"，
 * 不需要排版效果，纯文本反而更快看清。
 */
function DetailPanel({
  item,
  detail,
  loading,
}: {
  item: PendingItem;
  detail?: ReviewDetail;
  loading: boolean;
}) {
  if (loading) {
    return <p className="admin-muted text-xs p-3">加载详情…</p>;
  }

  // 图片：说说/动态是 images，图片组是 photos
  const images: string[] =
    detail?.images?.slice() ??
    (detail?.photos ?? []).map((p) => p.file_path);

  return (
    <div className="space-y-3 p-3">
      {item.meta ? (
        <div className="text-xs break-all">
          <span className="admin-muted">网址：</span>
          <a
            className="admin-link"
            href={item.meta}
            target="_blank"
            rel="noopener noreferrer"
          >
            {item.meta}
          </a>
        </div>
      ) : null}

      {detail?.content ? (
        <pre
          className="text-xs whitespace-pre-wrap break-words"
          style={{ margin: 0, fontFamily: "inherit" }}
        >
          {detail.content}
        </pre>
      ) : item.preview ? (
        <div className="admin-muted text-xs" style={{ whiteSpace: "pre-wrap" }}>
          {item.preview}
        </div>
      ) : (
        <p className="admin-muted text-xs">（这条内容没有正文）</p>
      )}

      {images.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {images.map((src, i) => (
            <img loading="lazy" decoding="async"
              key={`${src}-${i}`}
              src={resolveImageUrl(src) ?? ""}
              alt=""
              className="h-24 w-24 rounded object-cover"
              style={{ background: "rgba(255,255,255,0.06)" }}
            />
          ))}
        </div>
      )}

      {item.cover && images.length === 0 && (
        <img loading="lazy" decoding="async"
          src={resolveImageUrl(item.cover) ?? ""}
          alt=""
          className="h-24 w-24 rounded object-cover"
        />
      )}

      {/* 需要动内容时才离开审核页（当前页跳转，不开新标签）。
          看完改完可以用浏览器的后退回到这里继续审。 */}
      {editHref(item) ? (
        <div className="admin-actions pt-1">
          <a className="admin-btn admin-btn--ghost" href={editHref(item) as string}>
            去编辑这一条
          </a>
          <span className="admin-muted text-xs">
            改完记得回来点通过 / 驳回
          </span>
        </div>
      ) : null}
    </div>
  );
}

/** 详情接口返回的"能看的"那部分（各类型字段不同，用宽松类型） */
interface ReviewDetail {
  content?: string;
  images?: string[];
  photos?: { id: number; file_path: string; title?: string | null }[];
}

/** 按类型取详情的地址；友链的信息在列表里已经齐了，不需要再请求 */
const DETAIL_URL: Partial<Record<ReviewKind, (id: number) => string>> = {
  article: (id) => `/api/articles/${id}`,
  essay: (id) => `/api/essays/${id}`,
  life: (id) => `/api/life/${id}`,
  album: (id) => `/api/albums/${id}`,
};

export default function ReviewPage() {
  const [queue, setQueue] = useState<ReviewQueue | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<string>("");
  const [filter, setFilter] = useState<ReviewKind | "all">("all");

  // 页内展开的详情：openKey 是当前展开的那一条，details 缓存已取回的全文
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, ReviewDetail>>({});
  const [detailLoading, setDetailLoading] = useState<string | null>(null);

  const load = useCallback(() => {
    return fetchQueue()
      .then((q) => setQueue(q))
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : "加载失败")
      );
  }, []);

  // 首次加载：异步回调里 setState（effect 体内不能同步 setState）
  useEffect(() => {
    let alive = true;
    fetchQueue()
      .then((q) => {
        if (alive) setQueue(q);
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : "加载失败");
      });
    return () => {
      alive = false;
    };
  }, []);

  const flash = (msg: string) => {
    setNotice(msg);
    window.setTimeout(() => setNotice(""), 4000);
  };

  /** 展开 / 收起某一条的详情（不跳走，审核流程不中断） */
  const toggleDetail = (item: PendingItem) => {
    const key = `${item.kind}-${item.id}`;
    if (openKey === key) {
      setOpenKey(null);
      return;
    }
    setOpenKey(key);
    if (details[key]) return; // 已取过

    const build = DETAIL_URL[item.kind];
    if (!build) return;

    setDetailLoading(key);
    api
      .get<ReviewDetail>(build(item.id))
      .then((d) => setDetails((prev) => ({ ...prev, [key]: d })))
      .catch(() => undefined)
      .finally(() => setDetailLoading(null));
  };

  const handleDecide = async (
    item: PendingItem,
    decision: "approve" | "reject"
  ) => {
    let reason: string | undefined;
    if (decision === "reject") {
      const input = window.prompt(
        `驳回「${item.title}」的理由（会记进操作日志，可留空）：`
      );
      if (input === null) return; // 取消
      reason = input.trim() || undefined;
    }

    const key = `${item.kind}-${item.id}`;
    setBusy(key);
    setError("");
    try {
      await decide(item.kind, item.id, decision, reason);
      flash(decision === "approve" ? "已通过" : "已驳回");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusy("");
    }
  };

  const items = queue
    ? filter === "all"
      ? queue.items
      : queue.items.filter((i) => i.kind === filter)
    : [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold">内容审核</h1>
        <div className="admin-actions">
          <span className="admin-muted text-xs">
            {queue ? `待审 ${queue.total} 条` : ""}
          </span>
          <button
            type="button"
            className="admin-btn admin-btn--ghost"
            onClick={() => {
              setError("");
              void load();
            }}
          >
            <MorphIcon icon={RefreshCw} size={14} /> 刷新
          </button>
        </div>
      </div>

      {error && <p className="admin-error">{error}</p>}
      {notice && <p className="admin-ok">{notice}</p>}

      {/* 类型筛选 */}
      <div className="admin-actions" style={{ flexWrap: "wrap" }}>
        <button
          type="button"
          className={
            filter === "all" ? "admin-btn" : "admin-btn admin-btn--ghost"
          }
          onClick={() => setFilter("all")}
        >
          全部（{queue?.total ?? 0}）
        </button>
        {KIND_ORDER.map((k) => (
          <button
            key={k}
            type="button"
            className={
              filter === k ? "admin-btn" : "admin-btn admin-btn--ghost"
            }
            onClick={() => setFilter(k)}
          >
            {KIND_LABEL[k]}（{queue?.counts?.[k] ?? 0}）
          </button>
        ))}
      </div>

      {/* 列表 */}
      <div className="admin-panel admin-panel--flush">
        {queue === null ? (
          <p className="admin-muted p-6">加载中…</p>
        ) : items.length === 0 ? (
          <p className="admin-muted p-6">
            没有待审内容。成员发布后如果开了审核，内容会出现在这里。
          </p>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>类型</th>
                <th>内容</th>
                <th>作者</th>
                <th>提交时间</th>
                <th style={{ width: 220 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const key = `${item.kind}-${item.id}`;
                const working = busy === key;
                return (
                  <Fragment key={key}>
                    <tr>
                    <td>
                      <span className="admin-badge admin-badge--muted">
                        {item.kind_label}
                      </span>
                    </td>
                    <td>
                      <div className="flex items-start gap-3">
                        {/* 封面/首图：图片组和带图的说说能直接看到长什么样 */}
                        {item.cover ? (
                          <img loading="lazy" decoding="async"
                            src={resolveImageUrl(item.cover) ?? ""}
                            alt=""
                            className="h-12 w-12 flex-none rounded object-cover"
                            style={{ background: "rgba(255,255,255,0.06)" }}
                          />
                        ) : null}
                        <div className="min-w-0">
                          <div className="admin-user">
                            <span className="admin-user__name">
                              {item.title}
                            </span>
                            <span className="admin-muted text-xs">
                              #{item.id}
                            </span>
                          </div>
                          {item.meta ? (
                            <div className="admin-muted text-xs break-all">
                              {item.meta}
                            </div>
                          ) : null}
                          {item.preview ? (
                            <div
                              className="admin-muted text-xs"
                              style={{ whiteSpace: "pre-wrap" }}
                            >
                              {item.preview}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </td>
                    <td>{item.author_name}</td>
                    <td className="admin-cell-time">
                      {item.created_at
                        ? new Date(item.created_at).toLocaleString("zh-CN")
                        : "—"}
                    </td>
                    <td>
                      <div className="admin-actions">
                        {/* 页内展开：不跳走、不开新标签，审核流程不中断 */}
                        <button
                          type="button"
                          className="admin-link"
                          onClick={() => toggleDetail(item)}
                          title="在下面展开完整内容"
                        >
                          {openKey === key ? "收起" : "查看详情"}
                        </button>
                        <button
                          type="button"
                          className="admin-link"
                          disabled={working}
                          onClick={() => void handleDecide(item, "approve")}
                        >
                          {working ? "处理中…" : "通过"}
                        </button>
                        <button
                          type="button"
                          className="admin-link admin-link--danger"
                          disabled={working}
                          onClick={() => void handleDecide(item, "reject")}
                        >
                          驳回
                        </button>
                      </div>
                    </td>
                    </tr>

                    {/* 展开的详情行：全文 + 图片，看完就地通过或驳回 */}
                    {openKey === key && (
                      <tr>
                        <td colSpan={5} style={{ background: "rgba(255,255,255,0.03)" }}>
                          <DetailPanel
                            item={item}
                            detail={details[key]}
                            loading={detailLoading === key}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <p className="admin-muted text-xs">
        通过后内容立即对访客可见；驳回后仍保留在作者那里，ta 可以修改后重新提交。
        点「查看详情」会在这一行下面展开全文和图片，不离开本页；
        确实要改内容时再点「去编辑这一条」跳过去，改完回来通过或驳回。
      </p>
    </div>
  );
}
