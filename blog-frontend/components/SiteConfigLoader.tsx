"use client";

import { isDefaultTheme, readThemeOverride } from "@/lib/theme";
import { loadAuthors } from "@/lib/authors";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { api, withApiBase } from "@/lib/api";

export default function SiteConfigLoader() {
  const pathname = usePathname();

  useEffect(() => {
    api
      .get<{ configs: Record<string, string> }>("/api/site-config")
      .then(({ configs }) => {
        const root = document.documentElement;

        // 用户在前台选了一套成员主题时，**外观相关的配置不再由这里覆盖**，
        // 否则每次路由切换（这个 effect 依赖 pathname）都会把主题冲掉。
        // 站点标题、备案号这些非外观配置仍然照常应用。
        const themed = !isDefaultTheme() && readThemeOverride() !== null;

        if (!themed) {
          // ---- 主题色 ----
          if (configs.theme_accent) {
            root.style.setProperty("--accent", configs.theme_accent);
          }

          // ---- 卡片样式 ----
          // 优先级：localStorage 覆盖 > 后台配置 > 默认 glass
          let cardStyle = configs.card_style || "glass";
          try {
            const override = localStorage.getItem("card_style_override");
            if (override === "glass" || override === "black") {
              cardStyle = override;
            }
          } catch {}
          // 白名单校验后直接写入
          root.dataset.cardStyle = cardStyle === "black" ? "black" : "glass";

          // ---- 背景色 ----
          root.style.setProperty("--bg-color", configs.bg_color || "#0f1115");

          // ---- 背景图 ----
          if (configs.bg_type === "image" && configs.bg_image) {
            const url = withApiBase(configs.bg_image);
            root.style.setProperty("--bg-image", `url("${url}")`);
          } else {
            root.style.setProperty("--bg-image", "none");
          }

          // ---- 背景模糊 ----
          // blur 为 0 时不设 filter：blur(0px) 依然会建一个合成层，
          // 滚动时白白多一次合成。--bg-blur 留着给别处用。
          const blurPx = Number(configs.bg_blur || 0);
          root.style.setProperty("--bg-blur", `${blurPx}px`);
          root.style.setProperty(
            "--bg-filter",
            blurPx > 0 ? `blur(${blurPx}px)` : "none"
          );

          // ---- 背景遮罩 ----
          root.style.setProperty(
            "--bg-overlay",
            String(Number(configs.bg_overlay || 0))
          );
        }

        // ---- 站点标题 ----
        if (configs.site_title) {
          document.title = configs.site_title;
          const logoEl = document.getElementById("site-logo");
          if (logoEl) logoEl.textContent = configs.site_title;
        }

        // ---- 备案信息（ICP 备案号 / 公网安备号）----
        //
        // 号码来自后台「站点配置」，写进全局页脚，所以改号码不需要重新构建。
        // 没配置的那一项隐藏；两个都没配时整块不占位。
        //
        // 链接 href 写死在 layout.tsx 里（工信部/公安部备案系统），
        // 不从配置读取，避免这里被填成任意链接。
        const icp = (configs.icp_number || "").trim();
        const mps = (configs.public_security_number || "").trim();
        const filingEl = document.getElementById("footer-filing");
        const icpEl = document.getElementById("footer-icp");
        const icpLink = document.getElementById("footer-icp-link");
        const mpsEl = document.getElementById("footer-mps");
        const mpsLink = document.getElementById("footer-mps-link");

        if (icpEl) icpEl.textContent = icp;
        if (mpsEl) mpsEl.textContent = mps;
        if (icpLink) icpLink.hidden = !icp;
        if (mpsLink) mpsLink.hidden = !mps;
        if (filingEl) {
          // 显隐用 style.display：容器上带着 flex 类，
          // 用 hidden 属性会被 Tailwind 的 display:flex 覆盖掉。
          filingEl.style.display = icp || mps ? "flex" : "none";
        }
      })
      .catch(() => {});
    // pathname 变化时重新拉取，这样从后台返回前台能立即生效
  }, [pathname]);

    // 作者表预取：卡片渲染时就不用再等第二个请求了。
  // 之前是卡片先出、作者标签后到，视觉上会「跳一下」。
  void loadAuthors();

return null;
}