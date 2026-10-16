import Link from "next/link";

export const metadata = {
  title: "工具",
  description: "自用的小工具集合",
};

export default function ToolsPage() {
  return (
    <div className="tools-page">
      <header className="tools-hero">
        <h1 className="tools-hero__title">工具</h1>
        <p className="tools-hero__sub">一些自用的小工具</p>
      </header>

      <div className="tools-wip">
        {/* 纯 CSS 画的"施工中"图标，避免为一张图引入资源 */}
        <div className="tools-wip__icon" aria-hidden="true">
          <span className="tools-wip__cone" />
          <span className="tools-wip__bar" />
          <span className="tools-wip__bar" />
          <span className="tools-wip__bar" />
        </div>

        <h2 className="tools-wip__title">开发中</h2>
        <p className="tools-wip__text">
          这块还在做，先留个位置。
          <br />
          做好之后会放一些自用的小工具上来。
        </p>

        <Link href="/" className="tools-wip__back">
          ← 回首页
        </Link>
      </div>
    </div>
  );
}
