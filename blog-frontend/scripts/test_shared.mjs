/**
 * 前端共享模块自检（不需要浏览器 / 测试框架）
 * 用法：node scripts/test_shared.mjs
 */
import assert from "node:assert/strict";
import { parseLrc, findActiveLyricIndex } from "../lib/lrc.ts";
import {
  formatTime,
  formatClock,
  formatDateShort,
  formatDateTime,
  formatDateTimeSeconds,
  formatDateCN,
  formatDateTimeCN,
  formatDateDots,
  relativeTime,
} from "../lib/format.ts";
import { parseTags } from "../lib/tags.ts";
import { resolveImageUrl, resolveThumbUrl, toHttpsUrl } from "../lib/url.ts";
import { getStreamUrl, getLyricUrl, getCoverUrl, isNeteaseSong } from "../lib/types.ts";

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

console.log("=== parseLrc ===");
check("单行单标签", () => {
  const r = parseLrc("[00:12.00]你好");
  assert.equal(r.length, 1);
  assert.equal(r[0].text, "你好");
  assert.equal(r[0].time, 12);
});
check("一行多标签（合唱）会展开成多行", () => {
  const r = parseLrc("[00:12.00][01:20.50]同一句");
  assert.equal(r.length, 2);
  assert.equal(r[0].time, 12);
  assert.equal(r[1].time, 80.5);
  assert.equal(r[0].text, "同一句");
});
check("毫秒按 2 位和 3 位都能解析", () => {
  assert.equal(parseLrc("[00:01.5]a")[0].time, 1.5);
  assert.equal(parseLrc("[00:01.500]a")[0].time, 1.5);
  assert.equal(parseLrc("[00:01.05]a")[0].time, 1.05);
});
check("没有时间标签的元信息行被忽略", () => {
  assert.deepEqual(parseLrc("[ti:歌名]\n[ar:歌手]"), []);
});
check("空文本行被忽略", () => {
  assert.deepEqual(parseLrc("[00:01.00]\n[00:02.00]有内容"), [
    { time: 2, text: "有内容" },
  ]);
});
check("结果按时间升序", () => {
  const r = parseLrc("[00:30.00]晚\n[00:10.00]早");
  assert.deepEqual(r.map((x) => x.text), ["早", "晚"]);
});

console.log("\n=== findActiveLyricIndex ===");
const lyrics = [
  { time: 0, text: "a" },
  { time: 10, text: "b" },
  { time: 20, text: "c" },
];
check("处在区间内", () => assert.equal(findActiveLyricIndex(lyrics, 15), 1));
check("正好在边界上归下一行", () => assert.equal(findActiveLyricIndex(lyrics, 10), 1));
check("最后一行一直有效", () => assert.equal(findActiveLyricIndex(lyrics, 999), 2));
check("还没到第一行返回 -1", () => assert.equal(findActiveLyricIndex(lyrics, -5), -1));
check("空数组返回 -1", () => assert.equal(findActiveLyricIndex([], 5), -1));

console.log("\n=== 时间格式化 ===");
check("formatTime 常规", () => assert.equal(formatTime(125), "02:05"));
check("formatTime 0 / 非法值", () => {
  assert.equal(formatTime(0), "00:00");
  assert.equal(formatTime(NaN), "00:00");
  assert.equal(formatTime(Infinity), "00:00");
});
check("formatClock 补零", () => {
  assert.equal(formatClock(new Date(2025, 9, 12, 3, 4, 5)), "03:04:05");
});
check("formatDateShort", () =>
  assert.equal(formatDateShort("2025-10-12T14:30:05Z"), "2025-10-12"));
check("formatDateTime", () => {
  const d = new Date(2025, 9, 12, 14, 30, 5);
  assert.equal(formatDateTime(d.toISOString()), "2025-10-12 14:30");
});
check("formatDateTimeSeconds", () => {
  const d = new Date(2025, 9, 12, 14, 30, 5);
  assert.equal(formatDateTimeSeconds(d.toISOString()), "2025-10-12 14:30:05");
});
check("formatDateCN", () => {
  const d = new Date(2025, 9, 12);
  assert.equal(formatDateCN(d.toISOString()), "2025年10月12日");
});
check("formatDateTimeCN", () => {
  const d = new Date(2025, 9, 12, 9, 5);
  assert.equal(formatDateTimeCN(d.toISOString()), "2025年10月12日 09:05");
});
check("formatDateDots", () => {
  const d = new Date(2025, 9, 12);
  assert.equal(formatDateDots(d.toISOString()), "2025.10.12");
});
check("非法日期原样返回（不抛异常）", () => {
  assert.equal(formatDateShort("不是日期"), "不是日期");
  assert.equal(formatDateTime("不是日期"), "不是日期");
  assert.equal(formatDateDots("不是日期"), "不是日期");
});

console.log("\n=== relativeTime ===");
const ago = (ms) => new Date(Date.now() - ms).toISOString();
check("刚刚", () => assert.equal(relativeTime(ago(10 * 1000)), "刚刚"));
check("N 分钟前", () => assert.equal(relativeTime(ago(5 * 60 * 1000)), "5分钟前"));
check("N 小时前", () => assert.equal(relativeTime(ago(3 * 3600 * 1000)), "3小时前"));
check("N 天前", () => assert.equal(relativeTime(ago(5 * 86400 * 1000)), "5天前"));
check("超过 30 天回退到具体日期（默认 dots）", () => {
  const r = relativeTime(ago(60 * 86400 * 1000));
  assert.match(r, /^\d{4}\.\d{2}\.\d{2}$/);
});
check("full=short 时回退成 2025-10-12", () => {
  const r = relativeTime(ago(60 * 86400 * 1000), "short");
  assert.match(r, /^\d{4}-\d{2}-\d{2}$/);
});
check("full=cn 时回退成中文日期", () => {
  const r = relativeTime(ago(60 * 86400 * 1000), "cn");
  assert.match(r, /^\d{4}年\d{1,2}月\d{1,2}日$/);
});

console.log("\n=== parseTags ===");
check("普通拆分", () => assert.deepEqual(parseTags("a, b ,c"), ["a", "b", "c"]));
check("空值", () => {
  assert.deepEqual(parseTags(null), []);
  assert.deepEqual(parseTags(undefined), []);
  assert.deepEqual(parseTags(""), []);
});
check("忽略空项", () => assert.deepEqual(parseTags("a,,  ,b"), ["a", "b"]));
check("limit 截断", () => assert.deepEqual(parseTags("a,b,c,d", 2), ["a", "b"]));
check("limit 为 0 返回空", () => assert.deepEqual(parseTags("a,b", 0), []));

console.log("\n=== 图片 URL ===");
check("空值返回空串", () => {
  assert.equal(resolveImageUrl(null), "");
  assert.equal(resolveImageUrl(""), "");
});
check("完整 http/https URL 原样返回", () => {
  assert.equal(resolveImageUrl("https://a.com/x.jpg"), "https://a.com/x.jpg");
  assert.equal(resolveImageUrl("http://a.com/x.jpg"), "http://a.com/x.jpg");
});
check("站内绝对路径拼接后端地址", () =>
  assert.match(resolveImageUrl("/media/photos/x.jpg"), /\/media\/photos\/x\.jpg$/));
check("裸文件名落到 photos/", () =>
  assert.match(resolveImageUrl("abc.jpg"), /\/media\/photos\/abc\.jpg$/));
check("缩略图落到 thumbs/", () =>
  assert.match(resolveThumbUrl("abc.jpg"), /\/media\/thumbs\/abc\.jpg$/));
check("thumbs 前缀可覆盖", () =>
  assert.match(resolveImageUrl("abc.jpg", "covers"), /\/media\/covers\/abc\.jpg$/));
check("http 图片升级为 https", () => {
  assert.equal(toHttpsUrl("http://p1.music.126.net/a.jpg"), "https://p1.music.126.net/a.jpg");
  assert.equal(toHttpsUrl("https://x/a.jpg"), "https://x/a.jpg");
  assert.equal(toHttpsUrl(null), "");
});

console.log("\n=== 播放地址（本地 / 网易云）===");
const local = { id: 7, source: "local", cover_url: null };
const netease = { id: 9, source: "netease", netease_id: 12345, cover_url: null };

check("本地流走 /api/music/stream", () =>
  assert.match(getStreamUrl(local), /\/api\/music\/stream\/7$/));
check("网易云流走 /api/netease/stream", () =>
  assert.match(getStreamUrl(netease), /\/api\/netease\/stream\/12345$/));
check("本地歌词走 /api/music/lyrics", () =>
  assert.match(getLyricUrl(local), /\/api\/music\/lyrics\/7$/));
check("网易云歌词走 /api/netease/lyric", () =>
  assert.match(getLyricUrl(netease), /\/api\/netease\/lyric\/12345$/));
check("format=text 追加查询参数", () => {
  assert.match(getLyricUrl(local, "text"), /\?format=text$/);
  assert.match(getLyricUrl(netease, "text"), /\?format=text$/);
});
check("本地封面走后端接口", () =>
  assert.match(getCoverUrl(local), /\/api\/music\/cover\/7$/));
check("网易云无 cover_url 时返回空串（不拼后端接口）", () =>
  assert.equal(getCoverUrl(netease), ""));
check("网易云封面 http 升级 https", () =>
  assert.equal(
    getCoverUrl({ ...netease, cover_url: "http://p1.music.126.net/a.jpg" }),
    "https://p1.music.126.net/a.jpg"
  ));
check("isNeteaseSong 判定", () => {
  assert.equal(isNeteaseSong(local), false);
  assert.equal(isNeteaseSong(netease), true);
  assert.equal(isNeteaseSong({ id: 1, source: "netease" }), false); // 缺 netease_id
});

console.log();
if (failures.length) {
  console.log(`[失败] ${failures.length} 项不通过（通过 ${pass} 项）：`);
  for (const f of failures) console.log("  -", f);
  process.exit(1);
}
console.log(`[通过] 前端共享模块全部 ${pass} 项断言通过`);
