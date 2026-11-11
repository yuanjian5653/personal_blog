import { withApiBase } from "./api";

/**
 * 主题的应用与切换（前台）。
 *
 * 一套主题 = 强调色 + 背景（类型/色/图/模糊/遮罩）+ 卡片样式 + 首页卡片内容。
 * 前两条写进 CSS 变量，第三条写 data 属性，第四条写到 localStorage，
 * 由首页卡片组件读取（它们是运行时 fetch 站配置的，不能直接改 props）。
 *
 * 为什么用 localStorage 而不是重新请求：
 *   切换主题要**瞬时**生效，等一个网络往返会很顿。主题数据在切换时
 *   本来就已经拿到了，存下来供首页组件同步读取最直接。
 */

export interface ThemeLike {
  admin_id: number;
  owner_name: string;
  /** 成员头像：切换器直接显示头像，比纯色圆点好认 */
  owner_avatar?: string | null;
  is_published: boolean;
  name: string;
  theme_accent: string;
  bg_type: string;
  bg_color: string;
  bg_image: string;
  bg_blur: number;
  bg_overlay: number;
  card_text: string;
  card_wave_color1: string;
  card_wave_color2: string;
  home_album_id: number | null;
  updated_at?: string | null;
}

const LS_KEY = "theme_override";
const LS_DEFAULT = "theme_is_default";

/** 主题切换的广播事件名 */
export const THEME_EVENT = "dsh-theme-changed";

/** 读出当前覆盖的主题（"默认主题"时返回 null） */
export function readThemeOverride(): ThemeLike | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ThemeLike;
  } catch {
    return null;
  }
}

/** 当前选的是不是站长的默认主题 */
export function isDefaultTheme(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return localStorage.getItem(LS_DEFAULT) !== "0";
  } catch {
    return true;
  }
}

/**
 * 把主题写到 :root。
 *
 * 传 null 表示回到默认主题 —— 此时**不清空**变量，
 * 由 SiteConfigLoader 用站配置重新覆盖（它在路由变化时会重跑）。
 * 这里为了切换即时，也接受一份"站配置"的形态。
 */
export function applyTheme(
  theme: Pick<
    ThemeLike,
    | "theme_accent"
    | "bg_type"
    | "bg_color"
    | "bg_image"
    | "bg_blur"
    | "bg_overlay"
  > | null
): void {
  const root = document.documentElement;

  if (!theme) {
    root.style.removeProperty("--accent");
    root.style.removeProperty("--bg-color");
    root.style.removeProperty("--bg-image");
    root.style.removeProperty("--bg-blur");
    root.style.removeProperty("--bg-filter");
    root.style.removeProperty("--bg-overlay");
    return;
  }

  if (theme.theme_accent) {
    root.style.setProperty("--accent", theme.theme_accent);
  }
  root.style.setProperty("--bg-color", theme.bg_color || "#0f1115");

  if (theme.bg_type === "image" && theme.bg_image) {
    root.style.setProperty(
      "--bg-image",
      `url("${withApiBase(theme.bg_image)}")`
    );
  } else {
    root.style.setProperty("--bg-image", "none");
  }

  const blurPx = Number(theme.bg_blur || 0);
  root.style.setProperty("--bg-blur", `${blurPx}px`);
  // 和 SiteConfigLoader 保持一致：blur 为 0 就不建 filter 合成层
  root.style.setProperty("--bg-filter", blurPx > 0 ? `blur(${blurPx}px)` : "none");
  root.style.setProperty("--bg-overlay", String(Number(theme.bg_overlay || 0)));
  // 卡片样式（glass / black）不归主题管 —— 导航栏的「日夜切换」负责它
}

/** 把主题记下来（供首页卡片读取），并广播一次变更 */
export function commitTheme(theme: ThemeLike | null): void {
  if (typeof window === "undefined") return;
  try {
    if (theme) {
      localStorage.setItem(LS_KEY, JSON.stringify(theme));
      localStorage.setItem(LS_DEFAULT, "0");
      // 首页图片卡片是 5 分钟缓存的，清掉它下次进入首页就按新主题的相册取
      localStorage.removeItem("home_photos_cache");
    } else {
      localStorage.removeItem(LS_KEY);
      localStorage.setItem(LS_DEFAULT, "1");
    }
  } catch {
    /* 隐私模式下 localStorage 可能不可用，忽略 */
  }
  window.dispatchEvent(new CustomEvent(THEME_EVENT));
}

/** 订阅主题变更（首页卡片用）。返回取消订阅函数。 */
export function onThemeChange(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(THEME_EVENT, cb);
  return () => window.removeEventListener(THEME_EVENT, cb);
}

/** 从站配置（/api/site-config 的 configs）取出一份主题形态，用于"默认主题" */
export function themeFromConfigs(configs: Record<string, string>): ThemeLike {
  return {
    admin_id: 0,
    owner_name: "默认",
    owner_avatar: configs.author_avatar || null,
    is_published: true,
    name: "默认主题",
    theme_accent: configs.theme_accent || "#7c5cff",
    bg_type: configs.bg_type || "color",
    bg_color: configs.bg_color || "#0f1115",
    bg_image: configs.bg_image || "",
    bg_blur: Number(configs.bg_blur || 0),
    bg_overlay: Number(configs.bg_overlay || 0),
    card_text: configs.card_text || "",
    card_wave_color1: configs.card_wave_color1 || "#7c5cff",
    card_wave_color2: configs.card_wave_color2 || "#4cc9f0",
    home_album_id: configs.home_album_id ? Number(configs.home_album_id) : null,
    updated_at: null,
  };
}
