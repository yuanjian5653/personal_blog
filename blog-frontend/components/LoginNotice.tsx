"use client";

import { useEffect, useState } from "react";

/**
 * GitHub 登录结果提示。
 *
 * 后端回调后会带 `?comment_login=ok|fail&msg=...` 跳回**你发起登录的那个页面**，
 * 这里把结果显示出来 —— 否则登录失败时页面看起来毫无反应，
 * 用户只会觉得"登录了但还是不能评论"。
 *
 * 注意：刻意不用 `useSearchParams()`。该 hook 在本项目的 Next 版本里
 * **必须**包在 <Suspense> 里，否则静态预渲染会失败；而登录回跳是一次
 * 真实导航，组件会在带参数的目标页重新挂载，直接在 effect 里读
 * window.location.search 就够了，也更省一个边界。
 */
export default function LoginNotice() {
  const [notice, setNotice] = useState<{ ok: boolean; msg: string } | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get("comment_login");
    if (status !== "ok" && status !== "fail") return;

    // 一次性读取页面加载时的查询参数。依赖数组为空，不会循环触发，
    // 属于"从浏览器读取仅在客户端可得的信息"，故定点豁免该规则。
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 见上：一次性读取 URL
    setNotice({ ok: status === "ok", msg: params.get("msg") || "" });

    // 把参数从地址栏清掉，避免刷新后重复提示
    params.delete("comment_login");
    params.delete("msg");
    const qs = params.toString();
    const clean = window.location.pathname + (qs ? `?${qs}` : "");
    window.history.replaceState(null, "", clean);
  }, []);

  // 成功提示 3 秒后自动消失
  useEffect(() => {
    if (!notice || !notice.ok) return;
    const t = setTimeout(() => setNotice(null), 3000);
    return () => clearTimeout(t);
  }, [notice]);

  if (!notice) return null;

  return (
    <div
      role="status"
      className={`login-notice${notice.ok ? " is-ok" : " is-fail"}`}
    >
      <span className="login-notice__icon">{notice.ok ? "✓" : "⚠"}</span>
      <span className="login-notice__text">
        {notice.ok ? (
          "GitHub 登录成功，现在可以评论和点赞了"
        ) : (
          <>
            <b>登录失败：</b>
            {notice.msg || "未知原因"}
          </>
        )}
      </span>
      <button
        type="button"
        className="login-notice__close"
        onClick={() => setNotice(null)}
        aria-label="关闭"
      >
        ×
      </button>
    </div>
  );
}
