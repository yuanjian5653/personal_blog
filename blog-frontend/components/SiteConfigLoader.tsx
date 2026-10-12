"use client";

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
        document.documentElement.dataset.cardStyle =
          cardStyle === "black" ? "black" : "glass";

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
        const blur = Number(configs.bg_blur || 0);
        root.style.setProperty("--bg-blur", `${blur}px`);

        // ---- 背景遮罩 ----
        const overlay = Number(configs.bg_overlay || 0);
        root.style.setProperty("--bg-overlay", String(overlay));

        // ---- 站点标题 ----
        if (configs.site_title) {
          document.title = configs.site_title;
          const logoEl = document.getElementById("site-logo");
          if (logoEl) logoEl.textContent = configs.site_title;
        }
      })
      .catch(() => {});
    // pathname 变化时重新拉取，这样从后台返回前台能立即生效
  }, [pathname]);

  return null;
}