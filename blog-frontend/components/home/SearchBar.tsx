"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

import {
  getEggsServerSnapshot,
  getEggsSnapshot,
  submitCode,
  subscribeEggs,
  type UnlockResult,
} from "@/lib/easterEggs";

/**
 * 首页搜索框 —— 实际上是「输入暗号」的入口。
 *
 * 反馈策略：
 *   · 解锁成功 → 一行提示 + 边框闪一下
 *   · 暗号不对 → 一行"没这个暗号"（不弹窗，不打断）
 *   · 游戏类暗号 → 老实说还没做，别假装能玩
 *
 * 关于焦点样式：外层圆角容器的边框和阴影是**内联 style**，
 * 普通 CSS 优先级压不过内联声明，所以聚焦态必须用 !important
 * （见 easter-eggs.css 的 .search-shell:focus-within）。
 * 否则点进输入框完全看不出被选中了。
 */
export default function SearchBar() {
  const [value, setValue] = useState("");
  const [result, setResult] = useState<UnlockResult | null>(null);
  const [flash, setFlash] = useState(false);
  // 校验是网络请求，避免连点
  const [checking, setChecking] = useState(false);

  // localStorage 是"外部数据源"，用 useSyncExternalStore 读才不会触发
  // react-hooks/set-state-in-effect（在 effect 里同步 setState 会多一轮渲染）。
  const activeEggs = useSyncExternalStore(
    subscribeEggs,
    getEggsSnapshot,
    getEggsServerSnapshot
  );

  // 提示语 4 秒后自动收掉，避免一直挂在首页
  useEffect(() => {
    if (!result) return;
    const timer = window.setTimeout(() => setResult(null), 4000);
    return () => window.clearTimeout(timer);
  }, [result]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = value.trim();
    if (!code || checking) return;

    setChecking(true);
    try {
      // 暗号现在由后台校验（前端拿不到暗号列表）
      const res = await submitCode(code);
      setResult(res);
      setValue("");
      if (res.type === "effect" || res.type === "off") {
        // 让输入框边框闪一下，暗示"生效了"
        setFlash(true);
        window.setTimeout(() => setFlash(false), 600);
      }
    } finally {
      setChecking(false);
    }
  };

  // 已解锁的背景类彩蛋名字（游戏类不落盘，所以不会出现在这里）
  const activeNames = activeEggs
    .filter((e) => e.kind === "background")
    .map((e) => e.name);

  return (
    <div className="w-full max-w-xl mx-auto">
      <form onSubmit={handleSubmit}>
        <div
          className={`search-shell flex items-center gap-3 h-12 px-5 rounded-full${
            flash ? " is-flash" : ""
          }`}
          style={{
            background: "rgba(255, 255, 255, 0.1)",
            backdropFilter: "blur(20px) saturate(180%)",
            WebkitBackdropFilter: "blur(20px) saturate(180%)",
            border: "1px solid rgba(255, 255, 255, 0.15)",
            boxShadow:
              "inset 1.5px 1.5px 0 0 rgba(255,255,255,0.2), inset -1px -1px 0 0 rgba(255,255,255,0.05), 0 1px 2px rgba(0,0,0,0.1), 0 12px 28px -10px rgba(0,0,0,0.3)",
          }}
        >
          <svg
            className="search-shell__icon w-5 h-5 flex-shrink-0"
            style={{ color: "var(--text-secondary)" }}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>

          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="输入暗号探索更多..."
            className="search-shell__input flex-1 bg-transparent border-none outline-none text-sm"
            style={{ color: "var(--text-primary)" }}
            maxLength={40}
            aria-label="输入暗号"
            enterKeyHint="go"
          />

          {/* 有内容时才显示提示，平时保持原来的干净外观 */}
          {value.trim() && (
            <button
              type="submit"
              className="easter-go"
              aria-label="确认暗号"
              disabled={checking}
            >
              {checking ? "…" : "进入"}
            </button>
          )}
        </div>
      </form>

      {/* 反馈 */}
      <div className="easter-feedback" role="status" aria-live="polite">
        {result?.type === "effect" && (
          <p className="easter-feedback__ok">
            ✦ 解锁「{result.egg.name}」—— {result.egg.hint}
          </p>
        )}
        {result?.type === "game" && (
          <p className="easter-feedback__info">
            🎮 「{result.egg.name}」{result.egg.hint}
          </p>
        )}
        {result?.type === "off" && (
          <p className="easter-feedback__ok">已还原，彩蛋效果都关掉了</p>
        )}
        {result?.type === "unknown" && (
          <p className="easter-feedback__bad">这个暗号不对，再想想</p>
        )}

        {!result && activeNames.length > 0 && (
          <p className="easter-feedback__muted">
            已开启：{activeNames.join("、")} · 输入「关闭」可还原
          </p>
        )}
      </div>
    </div>
  );
}
