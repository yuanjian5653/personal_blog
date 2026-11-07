import type { Metadata } from "next";
import Link from "next/link";
import EasterEggHost from "@/components/layout/EasterEggHost";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Navbar from "@/components/layout/Navbar";
import { PlayerProvider } from "@/components/player/PlayerProvider";
import PlayerBar from "@/components/player/PlayerBar";
import SiteConfigLoader from "@/components/SiteConfigLoader";
import LoginNotice from "@/components/LoginNotice";
import VisitTracker from "@/components/VisitTracker";
import PageTransition from "@/components/layout/PageTransition";
import "highlight.js/styles/github-dark.css";
import "highlight.js/styles/atom-one-dark.css";


const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * 静态 metadata。
 *
 * ⚠️ 这里的 title 必须和后台「站点配置 → site_title」的默认值保持一致。
 *
 * 原因：站点名是可以在后台改的，而根 layout 是静态渲染的，
 * 首屏 HTML 里写的就是这个 title；等客户端 SiteConfigLoader 拉到
 * 后台配置后才用 document.title 覆盖。
 *
 * 两者不一致时，浏览器标签会先显示这里、再跳成后台的值 ——
 * 也就是"标题闪一下"。保持一致后默认情况下就完全不闪。
 *
 * （如果以后想改成"后台改完刷新即变且不闪"，需要把这里换成
 *   generateMetadata 在服务端拉配置，但会让所有页面失去静态预渲染，
 *   个人博客没必要，这里取简单方案。）
 */
export const metadata: Metadata = {
  title: "远见YuanJian",
  description: "个人博客 · 音乐 · 文章 · 图片",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="zh-CN"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {/* PlayerProvider 包裹整个应用，让任何页面都能控制播放器 */}
        <PlayerProvider>
          <SiteConfigLoader />
          <LoginNotice />
          <VisitTracker />
          <Navbar />
          <main className="pt-28 pb-24 max-w-6xl mx-auto px-6 w-full flex-1">
            <PageTransition>{children}</PageTransition>
          </main>
          <footer
            className="text-center text-sm py-8"
            style={{ color: "var(--text-secondary)" }}
          >
            <div>© {new Date().getFullYear()} 远见YuanJian</div>

            {/*
              备案信息（ICP 备案号 + 公网安备号）。
              号码来自后台「站点配置」，由 SiteConfigLoader 在拉取配置后填入，
              所以改号码不需要重新构建前端。

              默认 display:none —— 没配置号码时整块不占位。
              （不能用 hidden 属性配合 flex 类，那会被 Tailwind 的
                display:flex 覆盖掉，所以用内联 style 控制显隐。）
            */}
            <div
              id="footer-filing"
              className="mt-2 items-center justify-center gap-3 text-xs"
              style={{ display: "none" }}
            >
              <a
                id="footer-icp-link"
                href="https://beian.miit.gov.cn/"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:underline"
                hidden
              >
                <span id="footer-icp" />
              </a>
              <a
                id="footer-mps-link"
                href="https://beian.mps.gov.cn/"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:underline"
                hidden
              >
                <span id="footer-mps" />
              </a>
            </div>

            {/* 订阅入口：全站可见，但不抢眼 */}
            <div className="mt-2 text-xs">
              <Link
                href="/subscribe"
                className="hover:underline"
                style={{ color: "var(--text-secondary)" }}
              >
                邮件订阅
              </Link>
            </div>
          </footer>
          {/* 彩蛋效果（暗号解锁的背景星空等），全站生效 */}
          <EasterEggHost />

          {/* 全局播放条，固定底部 */}
          <PlayerBar />
        </PlayerProvider>
      </body>
    </html>
  );
}
