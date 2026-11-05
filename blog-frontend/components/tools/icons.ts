/**
 * 工具图标注册表。
 *
 * 为什么需要它：数据库里只存图标"名字"（字符串），而打包器**不支持**
 * 用变量路径动态 import（`import(`./icons/${name}`)` 会失败）。
 * 所以必须把可选图标写成一个静态表，按名字查。
 *
 * 加新图标 = 在这里 import 一次 + 加进 TOOL_ICONS。
 * 名字不存在时统一回退到 Wrench，不会出现"图标丢了"。
 */
import {
  Bookmark,
  Boxes,
  Cloud,
  Code2,
  Compass,
  Cpu,
  Database,
  Download,
  FileText,
  FolderKanban,
  Gauge,
  Globe,
  Hammer,
  Layers,
  Link2,
  ListMusic,
  Music,
  Palette,
  Rocket,
  Scissors,
  Search,
  Shapes,
  Smartphone,
  Sparkles,
  Terminal,
  Video,
  Wand2,
  Wrench,
  Zap,
} from "lucide";

export const TOOL_ICONS = {
  Wrench,
  Globe,
  Download,
  Code2,
  Terminal,
  Sparkles,
  Zap,
  Link2,
  FileText,
  Music,
  Video,
  Search,
  Database,
  Palette,
  Boxes,
  Hammer,
  Cpu,
  Bookmark,
  Compass,
  Gauge,
  Layers,
  Rocket,
  Scissors,
  Shapes,
  Smartphone,
  Wand2,
  Cloud,
  FolderKanban,
  ListMusic,
} as const;

export type ToolIconName = keyof typeof TOOL_ICONS;

/** 后台下拉的选项顺序 */
export const TOOL_ICON_NAMES = Object.keys(TOOL_ICONS) as ToolIconName[];

export const FALLBACK_ICON_NAME: ToolIconName = "Wrench";

/** 按名字取图标组件；找不到就用默认图标 */
export function resolveToolIcon(
  name: string | null | undefined
): (typeof TOOL_ICONS)[ToolIconName] {
  if (!name) return TOOL_ICONS[FALLBACK_ICON_NAME];
  const hit = (TOOL_ICONS as Record<string, (typeof TOOL_ICONS)[ToolIconName]>)[
    name
  ];
  return hit ?? TOOL_ICONS[FALLBACK_ICON_NAME];
}

/** 名字是否合法（后台表单校验用） */
export function isToolIconName(name: string | null | undefined): boolean {
  return !!name && name in TOOL_ICONS;
}
