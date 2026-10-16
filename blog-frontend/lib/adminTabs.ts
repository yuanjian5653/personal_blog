/**
 * 后台标签页管理
 * 用 sessionStorage 存已打开的标签，刷新后保留
 */

export interface AdminTab {
  href: string;
  label: string;
}

const STORAGE_KEY = "admin_tabs";

/**
 * 路径 → 标签名的规则。
 *
 * 之前这里只有一张"精确匹配"的表，导致**没列进去的路由直接显示英文路径**
 * （例如 /admin/comments、/admin/guestbook、/admin/posts/new），
 * 用户看到的就是一串 URL。
 *
 * 现在按顺序匹配：先规则（动态路由、子页面），再前缀匹配到所属栏目，
 * 最后才退回路径本身。
 */
const TAB_RULES: Array<{ test: (h: string) => boolean; label: (h: string) => string }> = [
  // 图片组编辑页：/admin/photos/12
  {
    test: (h) => /^\/admin\/photos\/\d+$/.test(h),
    label: (h) => `图片组 #${h.split("/").pop()}`,
  },
  // 新建 / 编辑文章：/admin/posts/new、/admin/posts/12
  {
    test: (h) => /^\/admin\/posts\/(new|\d+)$/.test(h),
    label: (h) => (h.endsWith("/new") ? "新建文章" : "编辑文章"),
  },
  // 新建 / 编辑随笔
  {
    test: (h) => /^\/admin\/essays\/(new|\d+)$/.test(h),
    label: (h) => (h.endsWith("/new") ? "新建随笔" : "编辑随笔"),
  },
];

/** 路径 → 栏目标签（前缀匹配） */
const PATH_LABELS: Record<string, string> = {
  "/admin/dashboard": "仪表盘",
  "/admin/profile": "关于内容",
  "/admin/posts": "文章管理",
  "/admin/essays": "随笔管理",
  "/admin/life": "生活动态",
  "/admin/music": "音乐管理",
  "/admin/photos": "图片管理",
  "/admin/projects": "项目管理",
  "/admin/tools": "工具管理",
  "/admin/friends": "友链管理",
  "/admin/comments": "评论管理",
  "/admin/guestbook": "杂谈管理",
  "/admin/site": "站点配置",
  "/admin/logs": "操作日志",
};

/** 根据路径获取标签名 */
export function getTabLabel(href: string): string {
  for (const rule of TAB_RULES) {
    if (rule.test(href)) return rule.label(href);
  }
  // 精确命中
  if (PATH_LABELS[href]) return PATH_LABELS[href];
  // 前缀命中（子页面归到所属栏目，取最长的那个前缀）
  let best = "";
  for (const prefix of Object.keys(PATH_LABELS)) {
    if (href.startsWith(prefix + "/") && prefix.length > best.length) {
      best = prefix;
    }
  }
  if (best) return PATH_LABELS[best];
  return href;
}

/** 读取所有标签 */
export function loadTabs(): AdminTab[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/** 保存标签 */
export function saveTabs(tabs: AdminTab[]) {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(tabs));
}

/** 打开一个标签（不存在则添加，已存在则忽略） */
export function openTab(tabs: AdminTab[], href: string): AdminTab[] {
  // 仪表盘作为默认首页，不重复添加
  if (tabs.some((t) => t.href === href)) return tabs;
  return [...tabs, { href, label: getTabLabel(href) }];
}

/** 关闭一个标签 */
export function closeTab(tabs: AdminTab[], href: string): AdminTab[] {
  return tabs.filter((t) => t.href !== href);
}