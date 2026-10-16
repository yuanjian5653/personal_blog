"use client";

import { useEffect, useState } from "react";

import {
  fetchProjects,
  languageColor,
  relativeFrom,
  type Project,
} from "@/lib/projects";

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchProjects()
      .then((list) => {
        if (!cancelled) setProjects(list);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "加载失败");
        setProjects([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const loading = projects === null;

  return (
    <div className="projects-page">
      <header className="projects-hero">
        <h1 className="projects-hero__title">项目</h1>
        <p className="projects-hero__sub">
          我在 GitHub 上写的东西
          {projects && projects.length > 0 && ` · 共 ${projects.length} 个`}
        </p>
      </header>

      {error && <p className="projects-error">加载失败：{error}</p>}

      {loading ? (
        // 骨架屏：用和卡片一致的网格，避免加载完成时布局跳动
        <div className="projects-grid">
          {[0, 1, 2].map((i) => (
            <div key={i} className="project-card project-card--skeleton" />
          ))}
        </div>
      ) : projects.length === 0 ? (
        <p className="projects-empty">
          还没有展示中的项目。
          <br />
          <span className="projects-empty__hint">
            在后台「项目管理」里点「同步 GitHub」即可拉取仓库。
          </span>
        </p>
      ) : (
        <div className="projects-grid">
          {projects.map((p) => (
            <ProjectCard key={p.id} project={p} />
          ))}
        </div>
      )}
    </div>
  );
}

function ProjectCard({ project: p }: { project: Project }) {
  return (
    <article className={`project-card${p.is_pinned ? " is-pinned" : ""}`}>
      {/* 置顶标记 */}
      {p.is_pinned && <span className="project-card__pin" title="置顶">📌</span>}

      <div className="project-card__head">
        <h2 className="project-card__title" title={p.full_name}>
          {p.title}
        </h2>
        {/* 语言：小圆点 + 名称，颜色用 GitHub 的官方语言色 */}
        {p.language && (
          <span className="project-card__lang">
            <i
              className="project-card__dot"
              style={{ background: languageColor(p.language) }}
            />
            {p.language}
          </span>
        )}
      </div>

      <p className="project-card__desc">
        {p.summary || "这个仓库还没有写简介"}
      </p>

      {/* 标签 */}
      {p.topics.length > 0 && (
        <div className="project-card__topics">
          {p.topics.slice(0, 4).map((t) => (
            <span key={t} className="project-card__topic">
              {t}
            </span>
          ))}
        </div>
      )}

      <div className="project-card__foot">
        <div className="project-card__stats">
          <span title="Star 数">★ {p.stars}</span>
          {p.forks > 0 && <span title="Fork 数">⑂ {p.forks}</span>}
          {p.license && <span title="开源协议">{p.license}</span>}
          {p.pushed_at && (
            <span title={`最近推送：${p.pushed_at}`}>
              更新于 {relativeFrom(p.pushed_at)}
            </span>
          )}
        </div>

        <div className="project-card__links">
          {/* 有线上地址时优先给"演示"，那是别人最想点的 */}
          {p.homepage && (
            <a
              className="project-card__link project-card__link--primary"
              href={p.homepage}
              target="_blank"
              rel="noopener noreferrer"
            >
              在线预览 →
            </a>
          )}
          <a
            className="project-card__link"
            href={p.html_url}
            target="_blank"
            rel="noopener noreferrer"
          >
            源码
          </a>
        </div>
      </div>

      {/* 整卡可点：把整个卡片做成指向仓库的链接覆盖层，
          但不要包住上面的 <a>，否则会 <a> 套 <a> 造成 hydration 错误 */}
      <a
        className="project-card__overlay"
        href={p.html_url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`打开 ${p.title} 的仓库`}
      />
    </article>
  );
}
