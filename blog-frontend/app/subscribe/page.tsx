"use client";

import { useState } from "react";
import Link from "next/link";

import { subscribe } from "@/lib/subscribe";

/**
 * 订阅页 /subscribe
 *
 * 流程：
 *   填邮箱 → POST /api/subscribe → 后端发确认信 → 用户点邮件里的链接才算订阅成功
 *   （double opt-in。不这样的话任何人可以拿你的域名给任意邮箱发信）
 *
 * 页面刻意不暴露任何"这个邮箱是否已订阅"的信息 —— 后端返回统一话术，
 * 前端也只提示"如果邮箱有效，确认邮件已发送"。
 */
type State =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "done"; message: string }
  | { kind: "error"; message: string };

export default function SubscribePage() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = email.trim();
    if (!value) return;

    setState({ kind: "submitting" });
    try {
      const res = await subscribe(value, "subscribe-page");
      setState({ kind: "done", message: res.message });
      setEmail("");
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : "提交失败，请稍后再试",
      });
    }
  };

  const submitting = state.kind === "submitting";

  return (
    <div className="subscribe-page">
      <header className="subscribe-head">
        <h1 className="subscribe-title">订阅更新</h1>
        <p className="subscribe-sub">
          留下邮箱，本站发布新文章、随笔时给你发一封通知邮件。
          <br />
          随时可以一键退订，不发广告，也不做别的事。
        </p>
      </header>

      {state.kind === "done" ? (
        <div className="subscribe-done">
          <span className="subscribe-done__mark" aria-hidden="true">
            ✉
          </span>
          <p className="subscribe-done__title">确认邮件已发送</p>
          <p className="subscribe-done__text">{state.message}</p>
          <p className="subscribe-done__hint">
            没看到？检查一下<strong>垃圾邮件箱</strong>，或者换一个邮箱再试。
          </p>
          <button
            type="button"
            className="subscribe-ghost"
            onClick={() => setState({ kind: "idle" })}
          >
            换个邮箱再试
          </button>
        </div>
      ) : (
        <form className="subscribe-form" onSubmit={submit}>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            required
            maxLength={254}
            disabled={submitting}
            aria-label="邮箱地址"
          />
          <button type="submit" disabled={submitting || !email.trim()}>
            {submitting ? "发送中…" : "订阅"}
          </button>
        </form>
      )}

      {state.kind === "error" && (
        <p className="subscribe-error">{state.message}</p>
      )}

      <section className="subscribe-notes">
        <h2>说明</h2>
        <ul>
          <li>
            <strong>需要确认一次</strong>：提交后会收到一封确认邮件，
            点里面的链接才算订阅成功（防止有人拿别人的邮箱乱订）。
          </li>
          <li>
            <strong>只发内容更新</strong>：新文章、随笔这类内容，
            不会发营销邮件，也不会把地址给别人。
          </li>
          <li>
            <strong>随时退订</strong>：每封邮件底部都有退订链接，
            点一下立即生效，不需要登录。
          </li>
        </ul>
      </section>

      {/* 返回按钮：与文章详情页、工具详情页同一套 .back-btn 效果 */}
      <Link
        href="/"
        className="back-btn subscribe-back"
        style={
          {
            "--btn-text": '"返回首页"',
            "--primary-color": "var(--card-text-sub)",
            "--hovered-color": "var(--accent)",
          } as React.CSSProperties
        }
      >
        <svg
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          strokeWidth={2.5}
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M10 19l-7-7m0 0l7-7m-7 7h18"
          />
        </svg>
        <p>返回首页</p>
      </Link>
    </div>
  );
}
