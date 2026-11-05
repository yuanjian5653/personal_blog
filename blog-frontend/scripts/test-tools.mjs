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
  emptyToolInput,
  splitTags,
  toolToInput,
} from "../lib/tools.ts";

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

/* ---------- 输出 ---------- */
console.log(
  `\n[${failures.length === 0 ? "通过" : "失败"}] 工具模块 ${passed} 项断言`
);
if (failures.length > 0) {
  for (const f of failures) console.log("  ✗ " + f);
  process.exit(1);
}
