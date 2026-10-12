/**
 * 后台标签页管理
 * 用 sessionStorage 存已打开的标签，刷新后保留
 */

export interface AdminTab {
  href: string;
  label: string;
}

const STORAGE_KEY = "admin_tabs";

/** 路径 → 标签名的映射 */
const PATH_LABELS: Record<string, string> = {
  "/admin/dashboard": "仪表盘",
  "/admin/profile": "关于内容",   // ← 新增
  "/admin/posts": "文章管理",
  "/admin/essays": "随笔管理",
  "/admin/life": "生活动态",
  "/admin/music": "音乐管理",
  "/admin/photos": "图片管理",
  "/admin/projects": "项目管理",
  "/admin/tools": "工具管理",
  "/admin/friends": "友链管理",
  "/admin/site": "站点配置",
  "/admin/logs": "操作日志",
};

/** 根据路径获取标签名 */
export function getTabLabel(href: string): string {
  // 图片组编辑页，附带组 ID
  if (/^\/admin\/photos\/\d+$/.test(href)) {
    const id = href.split("/").pop();
    return `图片组 #${id}`;
  }
  return PATH_LABELS[href] || href;
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