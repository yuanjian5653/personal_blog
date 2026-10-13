import type { Metadata } from "next";
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

export const metadata: Metadata = {
  title: "My Blog",
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
            © {new Date().getFullYear()} My Blog
          </footer>
          {/* 全局播放条，固定底部 */}
          <PlayerBar />
        </PlayerProvider>
      </body>
    </html>
  );
}
