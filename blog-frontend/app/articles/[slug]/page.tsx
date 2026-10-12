"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "@/lib/api";
import type { Article, ArticleListItem } from "@/lib/types";
import { formatDateTimeCN } from "@/lib/format";
import { parseTags } from "@/lib/tags";
import { resolveImageUrl } from "@/lib/url";
import { useMounted } from "@/lib/useMounted";
import { createPortal } from "react-dom";
import rehypeHighlight from "rehype-highlight";

import { MorphIcon } from "morphicons/react";
import { Calendar as CalendarIcon, Clock, FileText, Eye, Heart } from "lucide";

import ArticleSidebar from "@/components/article/ArticleSidebar";

interface TocItem {
  id: string;
  text: string;
  level: number;
}

interface TocNode extends TocItem {
  children: TocNode[];
}

/** 根据标题文本生成 slug id */
function slugifyHeading(text: string): string {
  const s = text
    .toLowerCase()
    .trim()
    .replace(/[^\w\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return s || "heading";
}

/** 把平铺的 toc 数组转成树形结构 */
function buildTocTree(items: TocItem[]): TocNode[] {
  const root: TocNode[] = [];
  const stack: TocNode[] = [];

  for (const item of items) {
    const node: TocNode = { ...item, children: [] };
    while (stack.length > 0 && stack[stack.length - 1].level >= item.level) {
      stack.pop();
    }
    if (stack.length === 0) {
      root.push(node);
    } else {
      stack[stack.length - 1].children.push(node);
    }
    stack.push(node);
  }
  return root;
}

export default function ArticleDetailPage() {
  const params = useParams();
  const router = useRouter();
  const slug = String(params.slug);

  const [article, setArticle] = useState<Article | null>(null);
  const [loading, setLoading] = useState(true);

  const [progress, setProgress] = useState(0);
  const [tocOpen, setTocOpen] = useState(false);
  const [activeTocId, setActiveTocId] = useState<string>("");
  const [toc, setToc] = useState<TocItem[]>([]);
  const [related, setRelated] = useState<ArticleListItem[]>([]);
  const [siteConfig, setSiteConfig] = useState<Record<string, string>>({});
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

    // 侧栏是否还在加载：作者信息未到位
  const sidebarLoading = Object.keys(siteConfig).length === 0;

  const contentRef = useRef<HTMLDivElement>(null);
  const mounted = useMounted();

  // 加载文章
  useEffect(() => {
    if (!slug) return;
    api
      .get<Article>(`/api/articles/slug/${slug}`)
      .then((a) => {
        setArticle(a);
        api.post(`/api/articles/${a.id}/view`).catch(() => {});
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [slug]);

  // 加载相关文章
  useEffect(() => {
    if (!article) return;
    api
      .get<ArticleListItem[]>(`/api/articles/${article.id}/related?limit=4`)
      .then(setRelated)
      .catch(() => setRelated([]));
  }, [article]);

  // 加载站点配置（作者信息）
  useEffect(() => {
    api
      .get<{ configs: Record<string, string> }>("/api/site-config")
      .then((d) => setSiteConfig(d.configs || {}))
      .catch(() => {});
  }, []);

  // 渲染后扫描真实 DOM，设置 id 并生成目录
  useEffect(() => {
    if (!article || !contentRef.current) return;

    const timer = setTimeout(() => {
      const container = contentRef.current;
      if (!container) return;

      const headings = container.querySelectorAll("h2, h3, h4");
      const counter: Record<string, number> = {};
      const items: TocItem[] = [];

      headings.forEach((el) => {
        const text = (el.textContent || "").trim();
        if (!text) return;

        let id = slugifyHeading(text);
        if (counter[id] !== undefined) {
          counter[id]++;
          id = `${id}-${counter[id]}`;
        } else {
          counter[id] = 0;
        }

        el.id = id;

        items.push({
          id,
          text,
          level: Number(el.tagName[1]),
        });
      });

      setToc(items);
    }, 50);

    return () => clearTimeout(timer);
  }, [article]);

  // 阅读进度
  useEffect(() => {
    if (!article) return;

    const handleScroll = () => {
      const doc = document.documentElement;
      const scrollTop = doc.scrollTop || document.body.scrollTop;
      const scrollHeight = doc.scrollHeight - doc.clientHeight;
      const p = scrollHeight > 0 ? (scrollTop / scrollHeight) * 100 : 0;
      setProgress(Math.min(100, Math.max(0, p)));
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener("scroll", handleScroll);
  }, [article]);

  // 滚动更新 active
  useEffect(() => {
    if (!article || toc.length === 0) return;

    const handleScroll = () => {
      const scrollTop = window.scrollY;
      const threshold = scrollTop + 140;

      let currentId = "";
      for (const item of toc) {
        const el = document.getElementById(item.id);
        if (!el) continue;
        const top = el.getBoundingClientRect().top + scrollTop;
        if (top <= threshold) {
          currentId = item.id;
        } else {
          break;
        }
      }

      const doc = document.documentElement;
      if (scrollTop + window.innerHeight >= doc.scrollHeight - 5) {
        currentId = toc[toc.length - 1].id;
      }

      if (currentId) setActiveTocId(currentId);
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener("scroll", handleScroll);
  }, [article, toc]);

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const jumpToHeading = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      const top = el.getBoundingClientRect().top + window.scrollY - 100;
      window.scrollTo({ top, behavior: "smooth" });
      setActiveTocId(id);
    }
  };

  const toggleCollapse = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (loading) {
    return <div style={{ color: "var(--text-secondary)" }}>加载中...</div>;
  }

  if (!article) {
    return (
      <div className="max-w-3xl mx-auto pt-2">
        <div
          className="glass p-10 text-center text-sm"
          style={{ color: "var(--text-secondary)" }}
        >
          文章不存在
        </div>
      </div>
    );
  }

  return (
    <>
      {/* 阅读进度条 */}
      {mounted &&
        createPortal(
          <div
            style={{
              position: "fixed",
              top: "64px",
              left: 0,
              right: 0,
              height: "3px",
              zIndex: 9998,
              pointerEvents: "none",
            }}
          >
            <div
              style={{
                width: `${progress}%`,
                height: "100%",
                background: "var(--accent)",
                boxShadow:
                  "0 0 12px color-mix(in srgb, var(--accent) 60%, transparent)",
                transition: "width 0.1s linear",
              }}
            />
          </div>,
          document.body
        )}

      {/* 两列布局：左侧栏，右主内容 */}
      <div className="article-page-grid">
        {/* ============ 侧栏（组件化） ============ */}
        <ArticleSidebar
          createdAt={article.created_at}
          siteConfig={siteConfig}
          related={related}
          loading={sidebarLoading}
        />

        {/* ============ 主内容 ============ */}
        <div className="article-main">
          {/* 主卡片 */}
          <div
            className="overflow-hidden"
            style={{
              borderRadius: 20,
              background: "rgba(255, 255, 255, 0.88)",
              backdropFilter: "blur(24px) saturate(140%)",
              WebkitBackdropFilter: "blur(24px) saturate(140%)",
              border: "1px solid rgba(255, 255, 255, 0.4)",
              boxShadow: "0 8px 32px rgba(0, 0, 0, 0.15)",
            }}
          >
            {article.cover_path && (
              <div
                className="w-full overflow-hidden"
                style={{ aspectRatio: "16/9" }}
              >
                <img
                  src={resolveImageUrl(article.cover_path)}
                  alt={article.title}
                  className="w-full h-full object-cover"
                />
              </div>
            )}

            <div style={{ padding: "clamp(28px, 5vw, 48px)" }}>
              <h1
                className="text-3xl md:text-4xl font-bold mb-6 leading-tight"
                style={{ color: "#111827" }}
              >
                {article.title}
              </h1>

              {article.excerpt && (
                <p
                  className="text-base mb-6 leading-relaxed"
                  style={{ color: "#6b7280" }}
                >
                  {article.excerpt}
                </p>
              )}

              {/* 元信息 */}
              <div
                className="flex flex-wrap items-center gap-4 text-xs mb-10 pb-6"
                style={{
                  color: "#9ca3af",
                  borderBottom: "1px solid rgba(0, 0, 0, 0.08)",
                }}
              >
                <span className="inline-flex items-center gap-1.5">
                  <MorphIcon icon={CalendarIcon} size={12} />
                  {formatDateTimeCN(article.created_at)}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <MorphIcon icon={Clock} size={12} />
                  {article.read_time} 分钟
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <MorphIcon icon={FileText} size={12} />
                  {article.word_count} 字
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <MorphIcon icon={Eye} size={12} />
                  {article.view_count}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <MorphIcon icon={Heart} size={12} />
                  {article.like_count}
                </span>

                {/* 标签 */}
                {article.tags && (
                  <div className="flex flex-wrap gap-1.5 ml-auto">
                    {parseTags(article.tags).map((tag) => (
                        <Link
                          key={tag}
                          href={`/articles?tag=${encodeURIComponent(tag)}`}
                          className="text-[11px] px-2 py-0.5 rounded transition-colors"
                          style={{
                            background:
                              "color-mix(in srgb, var(--accent) 12%, transparent)",
                            color: "var(--accent)",
                          }}
                        >
                          #{tag}
                        </Link>
                      ))}
                  </div>
                )}
              </div>

              {/* 正文 */}
              <div ref={contentRef} className="article-content-light">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeHighlight]}
                components={{
                  // 过滤空 src 的图片，避免报错
                  img: ({ src, alt, ...props }) => {
                    if (!src || src === "") return null;
                    return (
                      <img
                        src={src}
                        alt={alt || ""}
                        loading="lazy"
                        {...props}
                      />
                    );
                  },
                  // 外链加 target="_blank"
                  a: ({ href, children, ...props }) => {
                    const isExternal =
                      href && (href.startsWith("http") || href.startsWith("//"));
                    return (
                      <a
                        href={href}
                        {...(isExternal
                          ? { target: "_blank", rel: "noopener noreferrer" }
                          : {})}
                        {...props}
                      >
                        {children}
                      </a>
                    );
                  },
                }}
              >
                {article.content}
              </ReactMarkdown>
              </div>

              {/* 底部按钮行 */}
              <div
                className="mt-16 pt-8 flex justify-between items-center"
                style={{ borderTop: "1px solid rgba(0, 0, 0, 0.08)" }}
              >
                <button
                  onClick={() => router.push("/articles")}
                  className="back-btn"
                  style={
                    {
                      "--btn-text": '"返回文章列表"',
                      "--primary-color": "#4b5563",
                      "--hovered-color": "var(--accent)",
                    } as React.CSSProperties
                  }
                >
                  <svg
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    strokeWidth={2.5}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M10 19l-7-7m0 0l7-7m-7 7h18"
                    />
                  </svg>
                  <p>返回文章列表</p>
                </button>

                <button
                  onClick={() => {
                    api
                      .post(`/api/articles/${article.id}/like`)
                      .catch(() => {});
                    setArticle({
                      ...article,
                      like_count: article.like_count + 1,
                    });
                  }}
                  className="flex items-center gap-2 px-4 py-2 rounded-full hover:bg-black/5 transition-colors"
                  style={{ color: "var(--accent)" }}
                >
                  <MorphIcon icon={Heart} size={14} />
                  <span>点赞 {article.like_count}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 右下角浮动按钮组 */}
      {mounted &&
        createPortal(
          <div
            style={{
              position: "fixed",
              right: "24px",
              bottom: "96px",
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-end",
              gap: "12px",
              zIndex: 9999,
            }}
          >
            {tocOpen && toc.length > 0 && (
              <div
                className="glass no-scrollbar"
                style={{
                  borderRadius: 12,
                  width: "280px",
                  maxHeight: "60vh",
                  overflowY: "auto",
                  padding: "12px",
                  boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
                }}
              >
                <div className="flex items-center justify-between mb-2 px-2 pb-2 border-b border-white/10">
                  <span className="text-xs font-semibold tracking-wider uppercase">
                    目录
                  </span>
                  <button
                    onClick={() => setTocOpen(false)}
                    className="text-xs w-5 h-5 rounded hover:bg-white/10 flex items-center justify-center"
                    title="收起"
                  >
                    ×
                  </button>
                </div>
                <nav className="space-y-0.5">
                  <TocTree
                    nodes={buildTocTree(toc)}
                    depth={2}
                    activeId={activeTocId}
                    collapsed={collapsed}
                    onToggle={toggleCollapse}
                    onJump={jumpToHeading}
                  />
                </nav>
              </div>
            )}

            {toc.length > 0 && (
              <button
                onClick={() => setTocOpen((v) => !v)}
                className="w-11 h-11 rounded-full flex items-center justify-center transition-all hover:scale-110"
                style={{
                  background: tocOpen
                    ? "var(--accent)"
                    : "rgba(20, 22, 30, 0.9)",
                  color: tocOpen ? "#fff" : "var(--text-primary)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  backdropFilter: "blur(12px)",
                  WebkitBackdropFilter: "blur(12px)",
                  boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
                }}
                title={tocOpen ? "收起目录" : "展开目录"}
              >
                ☰
              </button>
            )}

            <button
              onClick={scrollToTop}
              className="w-11 h-11 rounded-full flex items-center justify-center transition-all hover:scale-110"
              style={{
                background: "var(--accent)",
                color: "#fff",
                boxShadow:
                  "0 4px 20px color-mix(in srgb, var(--accent) 50%, transparent)",
              }}
              title="回到顶部"
            >
              ↑
            </button>
          </div>,
          document.body
        )}
    </>
  );
}

/** 递归渲染目录树 */
function TocTree({
  nodes,
  depth,
  activeId,
  collapsed,
  onToggle,
  onJump,
}: {
  nodes: TocNode[];
  depth: number;
  activeId: string;
  collapsed: Set<string>;
  onToggle: (id: string) => void;
  onJump: (id: string) => void;
}) {
  return (
    <>
      {nodes.map((node) => {
        const isCollapsed = collapsed.has(node.id);
        const hasChildren = node.children.length > 0;
        const isActive = activeId === node.id;

        return (
          <div key={node.id}>
            <div
              className={`toc-item level-${node.level} ${
                isActive ? "active" : ""
              }`}
              style={{
                paddingLeft: `${(depth - 2) * 14}px`,
                display: "flex",
                alignItems: "center",
                gap: "4px",
              }}
              onClick={() => onJump(node.id)}
            >
              {hasChildren ? (
                <span
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggle(node.id);
                  }}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 14,
                    height: 14,
                    fontSize: 10,
                    cursor: "pointer",
                    color: isActive
                      ? "var(--accent)"
                      : "var(--text-secondary)",
                    flexShrink: 0,
                    transform: isCollapsed
                      ? "rotate(-90deg)"
                      : "rotate(0deg)",
                    transition: "transform 0.2s",
                  }}
                >
                  ▾
                </span>
              ) : (
                <span style={{ width: 14, flexShrink: 0 }} />
              )}
              <span style={{ flex: 1, minWidth: 0 }}>{node.text}</span>
            </div>

            {hasChildren && !isCollapsed && (
              <TocTree
                nodes={node.children}
                depth={depth + 1}
                activeId={activeId}
                collapsed={collapsed}
                onToggle={onToggle}
                onJump={onJump}
              />
            )}
          </div>
        );
      })}
    </>
  );
}