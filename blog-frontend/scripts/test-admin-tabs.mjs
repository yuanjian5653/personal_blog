/**
 * 后台标签名解析测试。
 *
 * 背景：之前这里只有一张"精确匹配"的表，没列进去的路由直接把路径当标签显示，
 * 于是后台标签栏出现了英文（/admin/comments、/admin/guestbook、
 * /admin/posts/new）。这类问题肉眼要翻到对应页面才看得到，用断言更省事。
 *
 * 用法：node --experimental-strip-types --loader ./scripts/ts-resolve-hook.mjs scripts/test-admin-tabs.mjs
 */
import assert from "node:assert/strict";
import { getTabLabel } from "../lib/adminTabs.ts";

let pass = 0;
const failures = [];

function check(label, fn) {
  try {
    fn();
    pass++;
    console.log(`  [OK ] ${label}`);
  } catch (e) {
    failures.push(`${label}: ${e.message}`);
    console.log(`  [FAIL] ${label}`);
    console.log(`         ${e.message.split("\n")[0]}`);
  }
}

console.log("=== 顶层栏目：必须是中文，不能出现英文路径 ===");
const TOP = {
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
for (const [href, want] of Object.entries(TOP)) {
  check(`${href} → ${want}`, () => assert.equal(getTabLabel(href), want));
}

console.log("\n=== 子页面：不该把 URL 当标签 ===");
check("/admin/posts/new → 新建文章", () =>
  assert.equal(getTabLabel("/admin/posts/new"), "新建文章"));
check("/admin/posts/12 → 编辑文章", () =>
  assert.equal(getTabLabel("/admin/posts/12"), "编辑文章"));
check("/admin/essays/new → 新建随笔", () =>
  assert.equal(getTabLabel("/admin/essays/new"), "新建随笔"));
check("/admin/essays/7 → 编辑随笔", () =>
  assert.equal(getTabLabel("/admin/essays/7"), "编辑随笔"));
check("/admin/photos/3 → 图片组 #3", () =>
  assert.equal(getTabLabel("/admin/photos/3"), "图片组 #3"));

console.log("\n=== 通用兜底：任何 /admin/xxx 子路径都该归到所属栏目 ===");
check("/admin/comments/anything → 评论管理", () =>
  assert.equal(getTabLabel("/admin/comments/anything"), "评论管理"));
check("/admin/guestbook/5 → 杂谈管理", () =>
  assert.equal(getTabLabel("/admin/guestbook/5"), "杂谈管理"));
check("/admin/site/advanced → 站点配置", () =>
  assert.equal(getTabLabel("/admin/site/advanced"), "站点配置"));

console.log("\n=== 关键回归：结果里不应出现英文路径 ===");
for (const href of Object.keys(TOP).concat([
  "/admin/posts/new", "/admin/posts/1", "/admin/essays/new",
  "/admin/photos/2", "/admin/comments/x", "/admin/guestbook/x",
])) {
  const label = getTabLabel(href);
  check(`${href} 的标签不是路径`, () =>
    assert.ok(!label.startsWith("/admin"), `得到的是路径本身：${label}`));
}

console.log();
if (failures.length) {
  console.log(`[失败] ${failures.length} 项不通过（通过 ${pass} 项）：`);
  for (const f of failures) console.log("  -", f);
  process.exit(1);
}
console.log(`[通过] 后台标签名全部 ${pass} 项断言通过`);
