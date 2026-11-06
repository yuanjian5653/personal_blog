/**
 * lib/tools.ts 的纯函数测试。
 *
 * 只测不依赖浏览器的部分（表单初始值、标签拆分、kind 文案表完整性、
 * 列表项与详情项的类型分工）。
 * 真正的规则校验在后端，由 blog-backend/scripts/test_tools.py 覆盖。
 *
 * 运行：
 *   node --experimental-strip-types --loader ./scripts/ts-resolve-hook.mjs \
 *        scripts/test-tools.mjs
 */
import {
  DEFAULT_CATEGORY,
  DEFAULT_ICON_NAME,
  KIND_ACTION,
  KIND_HINT,
  KIND_LABEL,
  KIND_PLACEHOLDER,
  DEFAULT_TOOL_COLOR,
  TOOL_COLOR_OPTIONS,
  emptyToolInput,
  splitTags,
  toolColorValue,
  toolToInput,
} from "../lib/tools.ts";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

let passed = 0;
const failures = [];

function eq(actual, expected, label) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) passed += 1;
  else failures.push(`${label}\n      期望 ${b}\n      实际 ${a}`);
}

/* ---------- 1. splitTags ---------- */
eq(splitTags(null), [], "null → []");
eq(splitTags(undefined), [], "undefined → []");
eq(splitTags(""), [], "空串 → []");
eq(splitTags("   "), [], "全空格 → []");
eq(splitTags("a"), ["a"], "单个");
eq(splitTags(" a , b , c "), ["a", "b", "c"], "去空格");
eq(splitTags("a,,b"), ["a", "b"], "空项被丢弃");
eq(splitTags("测试, 开发"), ["测试", "开发"], "中文标签");

/* ---------- 2. emptyToolInput ---------- */
const empty = emptyToolInput();
eq(empty.name, "", "初始 name 为空");
eq(empty.slug, "", "初始 slug 为空（后端自动生成）");
eq(empty.description, "", "初始正文为空");
eq(empty.category, DEFAULT_CATEGORY, "初始分类是默认值");
eq(empty.kind, "link", "初始类型是 link");
eq(empty.icon, DEFAULT_ICON_NAME, "初始图标是默认图标");
eq(empty.href, "", "初始地址为空");
eq(empty.sort_order, 0, "初始排序 0");
eq(empty.is_visible, true, "初始上架");

/* ---------- 3. toolToInput（详情项 → 表单）---------- */
const tool = {
  id: 7,
  slug: "my-tool",
  name: "某工具",
  summary: null,
  description: null,
  category: "视频",
  kind: "app",
  icon: null,
  href: "/media/tools/a.exe",
  tags: null,
  sort_order: 3,
  is_visible: false,
  click_count: 12,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z",
};
const input = toolToInput(tool);
eq(input.name, "某工具", "round-trip name");
eq(input.slug, "my-tool", "round-trip slug");
eq(input.summary, "", "summary null → 空串（表单受控）");
eq(input.description, "", "description null → 空串（表单受控）");
eq(input.tags, "", "tags null → 空串");
eq(input.icon, DEFAULT_ICON_NAME, "icon null → 默认图标");
eq(input.kind, "app", "round-trip kind");
eq(input.is_visible, false, "round-trip is_visible");
eq(input.sort_order, 3, "round-trip sort_order");
eq("id" in input, false, "表单字段不含 id");
eq("click_count" in input, false, "表单字段不含 click_count");

// 有正文时原样带出
const withDesc = toolToInput({ ...tool, description: "# 标题\n正文" });
eq(withDesc.description, "# 标题\n正文", "description 原样带出（不丢换行）");

/* ---------- 4. 三种 kind 的文案表完整 ---------- */
const KINDS = ["link", "page", "app"];
for (const k of KINDS) {
  eq(typeof KIND_LABEL[k], "string", `KIND_LABEL 有 ${k}`);
  eq(typeof KIND_HINT[k], "string", `KIND_HINT 有 ${k}`);
  eq(typeof KIND_PLACEHOLDER[k], "string", `KIND_PLACEHOLDER 有 ${k}`);
  eq(typeof KIND_ACTION[k], "string", `KIND_ACTION 有 ${k}`);
}
eq(Object.keys(KIND_LABEL).length, 3, "KIND_LABEL 恰好 3 项");
eq(Object.keys(KIND_HINT).length, 3, "KIND_HINT 恰好 3 项");
eq(Object.keys(KIND_ACTION).length, 3, "KIND_ACTION 恰好 3 项");

// 占位示例要能通过后端校验：link 必须 http、page 必须 / 开头
eq(KIND_PLACEHOLDER.link.startsWith("http"), true, "link 示例是 http 开头");
eq(KIND_PLACEHOLDER.page.startsWith("/"), true, "page 示例是 / 开头");
eq(KIND_PLACEHOLDER.app.startsWith("/"), true, "app 示例是 / 开头");

/* ---------- 配色 ---------- */
eq(emptyToolInput().color, DEFAULT_TOOL_COLOR, "新建默认配色是 default");
eq(toolToInput({
  id: 1, slug: "s", name: "n", summary: null, category: "其他",
  kind: "link", icon: null, color: "amber", href: "https://x.com",
  tags: null, sort_order: 0, is_visible: true, click_count: 0,
  created_at: "", updated_at: "", description: null,
}).color, "amber", "编辑时回填已有配色");
eq(toolToInput({
  id: 1, slug: "s", name: "n", summary: null, category: "其他",
  kind: "link", icon: null, color: null, href: "https://x.com",
  tags: null, sort_order: 0, is_visible: true, click_count: 0,
  created_at: "", updated_at: "", description: null,
}).color, DEFAULT_TOOL_COLOR, "color 为 null 时回填 default");

eq(TOOL_COLOR_OPTIONS.length >= 6, true, "配色至少 6 种");
eq(TOOL_COLOR_OPTIONS[0].key, "default", "第一项是 default");
eq(TOOL_COLOR_OPTIONS[0].swatch, "", "default 没有固定色值（跟随主题）");

const swatchKeys = TOOL_COLOR_OPTIONS.filter((c) => c.key !== "default");
eq(swatchKeys.every((c) => /^#[0-9a-f]{6}$/i.test(c.swatch)), true,
   "除 default 外都有 6 位十六进制色值");
eq(new Set(TOOL_COLOR_OPTIONS.map((c) => c.key)).size, TOOL_COLOR_OPTIONS.length,
   "key 不重复");
eq(new Set(TOOL_COLOR_OPTIONS.map((c) => c.label)).size, TOOL_COLOR_OPTIONS.length,
   "label 不重复");
eq(TOOL_COLOR_OPTIONS.every((c) => c.key === c.key.toLowerCase()), true,
   "key 全小写（后端白名单也是小写）");

eq(toolColorValue("amber"), "#d9a441", "toolColorValue 取到色值");
eq(toolColorValue("default"), "", "default 取到空串（交给 CSS 回退）");
eq(toolColorValue(null), "", "null 取到空串");
eq(toolColorValue("nope"), "", "未知 key 取到空串（不抛错）");

/* ---------- 与后端的白名单保持一致 ---------- *
 * 配色 key 同时存在于前端（用于渲染/色板）和后端（用于校验），
 * 两边不一致的后果很隐蔽：后台能选出某个颜色，但保存时被后端拒掉。
 * 所以这里直接读后端源码比对，把漂移挡在测试阶段。
 */
const here = dirname(fileURLToPath(import.meta.url));
const backendSchema = resolve(here, "../../blog-backend/app/schemas/tool.py");
const schemaSrc = readFileSync(backendSchema, "utf8");
const m = schemaSrc.match(/TOOL_COLORS\s*=\s*\(([\s\S]*?)\)/);
if (!m) {
  failures.push("没能在后端 schemas/tool.py 里解析出 TOOL_COLORS");
} else {
  // 直接抽双引号里的内容，注释、逗号、换行都不用手动清理
  const backendKeys = [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  eq(backendKeys, TOOL_COLOR_OPTIONS.map((c) => c.key),
     "前后端配色清单完全一致（顺序也一致）");
}

/* ---------- 输出 ---------- */
console.log(
  `\n[${failures.length === 0 ? "通过" : "失败"}] 工具模块 ${passed} 项断言`
);
if (failures.length > 0) {
  for (const f of failures) console.log("  ✗ " + f);
  process.exit(1);
}
