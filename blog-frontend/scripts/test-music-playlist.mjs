/**
 * 播放列表合并/筛选的测试（纯函数，无需浏览器）。
 *
 * 关注点：
 *   1. 本地在前、网易云在后
 *   2. 去重按 source+id，本地 id 与网易云 id 数值相同也不能算同一首
 *   3. 关键词筛选忽略大小写、覆盖标题/歌手/专辑
 *   4. 统计与定位（indexOfSong）
 *
 * 用法：
 *   node --experimental-strip-types --loader ./scripts/ts-resolve-hook.mjs \
 *        scripts/test-music-playlist.mjs
 */
import {
  filterSongs,
  indexOfSong,
  mergePlaylists,
  playlistStats,
  songKey,
} from "../lib/musicPlaylist.ts";

let passed = 0;
const fails = [];

function ok(label, cond, extra = "") {
  if (cond) {
    passed += 1;
    console.log(`  [OK ] ${label}`);
  } else {
    fails.push(`${label} ${extra}`);
    console.log(`  [FAIL] ${label} ${extra}`);
  }
}

function eq(label, got, want) {
  const a = JSON.stringify(got);
  const b = JSON.stringify(want);
  ok(label, a === b, a === b ? "" : `got=${a} want=${b}`);
}

/** 造一首歌 */
function song(patch) {
  return {
    id: 1,
    title: "曲名",
    artist: "歌手",
    album: "专辑",
    duration: 180,
    cover_path: null,
    lyrics_path: null,
    genre: null,
    year: null,
    bitrate: null,
    file_size: null,
    play_count: 0,
    created_at: "2026-01-01T00:00:00Z",
    source: "local",
    ...patch,
  };
}

const localA = song({ id: 1, title: "Alpha", artist: "本地歌手", source: "local" });
const localB = song({ id: 2, title: "Beta", artist: "LocalBand", source: "local" });
const neteaseA = song({
  id: -1,
  title: "Gamma",
  artist: "NetArtist",
  album: "网专辑",
  source: "netease",
  netease_id: 1,
});
const neteaseB = song({
  id: -7,
  title: "Delta",
  artist: "云村",
  source: "netease",
  netease_id: 7,
});

console.log("=== 1. songKey 区分来源 ===");
ok(
  "本地 1 与网易云 -1 的 key 不同",
  songKey(localA) !== songKey(neteaseA),
  `${songKey(localA)} vs ${songKey(neteaseA)}`
);
eq("本地 key 带 local 前缀", songKey(localA), "local:1");
eq("网易云 key 带 netease 前缀", songKey(neteaseA), "netease:-1");
eq(
  "缺省 source 视为 local",
  songKey({ ...localA, source: undefined }),
  "local:1"
);

console.log("\n=== 2. 合并顺序：本地在前 ===");
{
  const merged = mergePlaylists([localA, localB], [neteaseA, neteaseB]);
  eq("总数", merged.length, 4);
  eq("第 1 首是本地", merged[0].title, "Alpha");
  eq("第 2 首是本地", merged[1].title, "Beta");
  eq("第 3 首是网易云", merged[2].title, "Gamma");
  eq("第 4 首是网易云", merged[3].title, "Delta");
  ok(
    "本地全部排在网易云之前",
    merged.findIndex((s) => s.source === "netease") === 2,
    JSON.stringify(merged.map((s) => s.source))
  );
}

console.log("\n=== 3. 去重 ===");
{
  const merged = mergePlaylists([localA, localA], [neteaseA, neteaseA]);
  eq("重复项被去掉", merged.length, 2);
  eq("保留的是首次出现的那条", merged[0].title, "Alpha");

  // 关键：本地 id=1 与网易云 id=-1 不是同一首
  const collide = mergePlaylists(
    [song({ id: 1, title: "本地一号" })],
    [song({ id: -1, title: "云端一号", source: "netease", netease_id: 1 })]
  );
  eq("数值 id 相同但来源不同 → 不合并", collide.length, 2);

  eq("空列表合并空列表", mergePlaylists([], []).length, 0);
  eq("本地为空时只留网易云", mergePlaylists([], [neteaseA]).length, 1);
  eq("网易云为空时只留本地", mergePlaylists([localA], []).length, 1);
}

console.log("\n=== 4. 不修改入参 ===");
{
  const local = [localA];
  const net = [neteaseA];
  const merged = mergePlaylists(local, net);
  eq("本地数组长度不变", local.length, 1);
  eq("网易云数组长度不变", net.length, 1);
  ok("返回的是新数组", merged !== local && merged !== net);
}

console.log("\n=== 5. 关键词筛选 ===");
{
  const all = [localA, localB, neteaseA, neteaseB];
  eq("空关键词返回全部", filterSongs(all, "").length, 4);
  eq("纯空白关键词返回全部", filterSongs(all, "   ").length, 4);
  eq("按标题（小写匹配大写标题）", filterSongs(all, "gamma").length, 1);
  eq("按歌手", filterSongs(all, "netartist").length, 1);
  eq("按中文歌手", filterSongs(all, "云村").length, 1);
  eq("按专辑（仅网易云有该专辑）", filterSongs(all, "网专辑").length, 1);
  eq("无匹配返回空", filterSongs(all, "zzz").length, 0);
  eq("关键词首尾空格被忽略", filterSongs(all, "  alpha  ").length, 1);
}

console.log("\n=== 6. 统计 ===");
{
  const stats = playlistStats([localA, localB, neteaseA]);
  eq("总数", stats.total, 3);
  eq("本地数", stats.local, 2);
  eq("网易云数", stats.netease, 1);
  eq("总时长", stats.duration, 540);

  const empty = playlistStats([]);
  eq("空列表统计", empty, { total: 0, local: 0, netease: 0, duration: 0 });

  // duration 缺失/异常不应污染总和
  const weird = playlistStats([
    song({ duration: 100 }),
    song({ id: 9, duration: 0 }),
    song({ id: 10, duration: undefined }),
  ]);
  eq("异常时长被忽略", weird.duration, 100);
}

console.log("\n=== 7. indexOfSong 定位 ===");
{
  const all = [localA, localB, neteaseA];
  eq("找到本地歌", indexOfSong(all, localB), 1);
  eq("找到网易云歌", indexOfSong(all, neteaseA), 2);
  eq("当前为空 → -1", indexOfSong(all, null), -1);
  eq(
    "不在列表里 → -1",
    indexOfSong(all, song({ id: 999, title: "外来" })),
    -1
  );
}

console.log();
if (fails.length) {
  console.log(`[失败] ${fails.length} 项不通过：`);
  for (const f of fails) console.log("  -", f);
  process.exit(1);
}
console.log(`[通过] 播放列表合并与筛选全部 ${passed} 项断言通过`);
