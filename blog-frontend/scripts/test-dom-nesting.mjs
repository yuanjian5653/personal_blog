/**
 * 检查"交互元素嵌套"这类会导致 hydration 失败的非法 HTML。
 *
 * 起因：ProfileCard 曾用 <Link> 包住整张卡片，而卡片内又有社交 <a>，
 * 触发 "In HTML, <a> cannot be a descendant of <a>"。
 * 这里做静态检查，避免同类问题再被写回来。
 *
 * 用法：node --experimental-strip-types --loader ./scripts/ts-resolve-hook.mjs scripts/test-dom-nesting.mjs
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// 用 fileURLToPath 而不是手写 replace：路径含中文时 import.meta.url
// 是百分号编码的，直接当路径用会 ENOENT。
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const VOID_TAGS = new Set(["img", "br", "hr", "input", "meta", "source", "link"]);

/** 递归收集 .tsx 文件 */
function collect(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) collect(p, out);
    else if (name.endsWith(".tsx")) out.push(p);
  }
  return out;
}

/**
 * 朴素但够用的嵌套检测：逐行扫描开始/结束标签，
 * 维护一个「尚未闭合的标签」栈；若压入 a/Link 时栈里已有 a/Link，
 * 就是非法嵌套。
 */
function findNesting(source) {
  const src = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  const lines = src.split("\n");
  const open = [];
  const problems = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 先处理结束标签
    for (const cm of line.matchAll(/<\/([A-Za-z][\w.]*)\s*>/g)) {
      const t = cm[1].toLowerCase();
      const at = open.lastIndexOf(t);
      if (at >= 0) open.splice(at, 1);
    }

    // 再处理开始标签
    for (const om of line.matchAll(/<([A-Za-z][\w.]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g)) {
      const tag = om[1].toLowerCase();
      const selfClose = om[3] === "/";
      if (selfClose) continue;
      if (VOID_TAGS.has(tag) && tag !== "link") continue;

      const isLinkish = tag === "a" || tag === "link";
      if (isLinkish) {
        const enclosing = open.filter((t) => t === "a" || t === "link");
        if (enclosing.length > 0) {
          problems.push({ line: i + 1, tag, enclosing: enclosing.length });
        }
      }
      open.push(tag);
    }
  }

  return problems;
}

const files = collect(join(ROOT, "app")).concat(collect(join(ROOT, "components")));
const allProblems = [];
for (const f of files) {
  for (const p of findNesting(readFileSync(f, "utf8"))) {
    allProblems.push({ file: relative(ROOT, f).replace(/\\/g, "/"), ...p });
  }
}

console.log(`扫描 ${files.length} 个 .tsx 文件`);
console.log();

// 针对已知问题点做结构断言
const profile = readFileSync(join(ROOT, "components/home/ProfileCard.tsx"), "utf8");
console.log("=== ProfileCard 结构检查 ===");
const checks = [
  ["外层不再用 <Link> 包整卡", !/<Link\s+href="\/about"\s+className="glass/.test(profile)],
  ["改用普通 div 作为卡片根元素", /<div className="glass p-6 flex flex-col h-full card-glow">/.test(profile)],
  ["保留通往 /about 的 Link（仅头像+姓名+简介）", /<Link[\s\S]{0,80}href="\/about"/.test(profile)],
  ["社交按钮仍是 <a>", /<a\b[^>]*className="profile-social-btn"/.test(profile)],
  ["社交按钮不在 <Link> 内（关键）", !/<Link[\s\S]*?profile-social-btn[\s\S]*?<\/Link>/.test(profile)],
];
let ok = true;
for (const [label, passed] of checks) {
  console.log(`  [${passed ? "OK " : "FAIL"}] ${label}`);
  if (!passed) ok = false;
}

console.log();
if (allProblems.length) {
  ok = false;
  console.log(`[失败] 发现 ${allProblems.length} 处疑似交互元素嵌套：`);
  for (const p of allProblems) {
    console.log(`  ${p.file}:${p.line}  <${p.tag}> 套在 ${p.enclosing} 层 a/link 内`);
  }
} else {
  console.log("[通过] 未发现 <a>/<Link> 相互嵌套");
}

process.exit(ok ? 0 : 1);
