"use client";

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "@/lib/api";
import { resolveImageUrl } from "@/lib/url";

interface Config {
  author_name?: string;
  author_bio?: string;
  author_avatar?: string;
  about_subtitle?: string;
  about_banner?: string;
  about_content?: string;
}

export default function AboutPage() {
  const [cfg, setCfg] = useState<Config>({});

  useEffect(() => {
    api
      .get<{ configs: Record<string, string> }>("/api/site-config")
      .then((d) => setCfg(d.configs))
      .catch(() => {});
  }, []);

  // 图片 URL 处理
  const resolveUrl = (url?: string) => resolveImageUrl(url);

  const banner = resolveUrl(cfg.about_banner);
  const avatar = resolveUrl(cfg.author_avatar);
  const name = cfg.author_name || "博主";
  const subtitle = cfg.about_subtitle || "HELLO WORLD";

  return (
    <div className="max-w-2xl mx-auto pt-2">
      {/* 整张卡片 */}
      <div className="glass overflow-hidden" style={{ borderRadius: 20 }}>
              {/* 顶部横幅 */}
      <div
        className="relative w-full"
        style={{
          height: "200px",
          background: banner
            ? `url(${banner}) center/cover no-repeat`
            : "linear-gradient(135deg, rgba(124,92,255,0.4), rgba(255,107,107,0.3))",
          zIndex: 1,
        }}
      />

      {/* 内容区 */}
      <div className="px-10 pb-10 relative" style={{ zIndex: 2 }}>
        {/* 头像：用负 marginTop 压到横幅上 */}
        <div
          className="w-24 h-24 rounded-full overflow-hidden"
          style={{
            marginTop: "-48px",
            border: "4px solid rgba(20,22,30,0.9)",
            boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
            position: "relative",
            zIndex: 3,
            background: "rgba(20,22,30,0.9)",
          }}
        >
          {avatar ? (
            <img
              src={avatar}
              alt={name}
              className="w-full h-full object-cover"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
          ) : (
            <div
              className="w-full h-full flex items-center justify-center text-3xl font-bold text-white"
              style={{ background: "var(--accent)" }}
            >
              {name[0]}
            </div>
          )}
        </div>

          {/* 标题 */}
          <h1 className="text-3xl font-bold mt-6 mb-2">关于我</h1>
          <p
            className="text-sm tracking-widest mb-8"
            style={{ color: "var(--accent)", letterSpacing: "0.15em" }}
          >
            {subtitle}
          </p>

          {/* Markdown 内容 */}
          <div className="prose-custom">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {cfg.about_content || ""}
            </ReactMarkdown>
          </div>
        </div>
      </div>
    </div>
  );
}