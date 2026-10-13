/**
 * 打字机状态机测试（纯函数，无需浏览器）
 * 用法：node --experimental-strip-types --loader ./scripts/ts-resolve-hook.mjs scripts/test_typewriter.mjs
 */
import assert from "node:assert/strict";
import {
  alignSnapshot,
  initialSnapshot,
  isTypingCursorVisible,
  nextSnapshot,
} from "../lib/typewriter-core.ts";

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

/** 把状态机跑 n 步，返回每一步的快照序列 */
function runSteps(text, steps, options = {}, start = initialSnapshot(text)) {
  const seq = [];
  let snap = start;
  for (let i = 0; i < steps; i++) {
    seq.push({ ...snap });
    const step = nextSnapshot(snap, text, options);
    if (!step.continues) break;
    snap = step.next;
  }
  return seq;
}

const OPTS = { typeSpeed: 1, deleteSpeed: 1, holdAfterType: 1, holdAfterDelete: 1 };

console.log("=== 完整循环：打字 → 停顿 → 删除 → 停顿 → 重打 ===");
check("会依次出现 typing → holding → deleting → waiting 四个阶段", () => {
  const seq = runSteps("abc", 40, { ...OPTS, loop: true });
  const phases = [...new Set(seq.map((s) => s.phase))];
  for (const p of ["typing", "holding", "deleting", "waiting"]) {
    assert.ok(phases.includes(p), `缺少阶段 ${p}（实际出现: ${phases.join(",")}）`);
  }
});

check("删除阶段真的会把字符逐个删掉（关键回归点）", () => {
  const text = "abcdef";
  const seq = runSteps(text, 60, { ...OPTS, loop: true });

  // 只取"第一个完整的删除阶段"：从 deleting 开始到第一次离开 deleting 为止
  const start = seq.findIndex((s) => s.phase === "deleting");
  assert.ok(start >= 0, "完全没有进入删除阶段");
  let end = start;
  while (end < seq.length && seq[end].phase === "deleting") end++;
  const phaseRuns = seq.slice(start, end);

  const lens = phaseRuns.map((s) => s.shown.length);
  assert.ok(lens[0] === text.length, `删除阶段起点长度应为 ${text.length}，实际 ${lens[0]}`);
  assert.ok(
    lens[lens.length - 1] === 0,
    `第一个删除阶段应把文字删空，实际剩 ${lens[lens.length - 1]}`
  );
  // 逐字递减，绝不回弹
  for (let i = 1; i < lens.length; i++) {
    assert.ok(
      lens[i] < lens[i - 1],
      `第 ${i} 步没有继续删除：${lens[i - 1]} → ${lens[i]}`
    );
  }
  // 删除字数 == 原文字数
  assert.equal(
    phaseRuns.length - 1,
    text.length,
    `删除步数应等于字符数 ${text.length}，实际 ${phaseRuns.length - 1}`
  );
});

check("打完整句后 shown 等于原文", () => {
  const seq = runSteps("hello", 30, { ...OPTS, loop: true });
  const full = seq.filter((s) => s.phase !== "deleting" && s.shown === "hello");
  assert.ok(full.length > 0, "从未打出完整句子");
});

check("删空后会重新从 0 开始打（第二轮循环）", () => {
  const seq = runSteps("ab", 30, { ...OPTS, loop: true });
  // 找 waiting 之后是否又回到 typing 且 shown 为 0
  const waitIdx = seq.findIndex((s) => s.phase === "waiting");
  assert.ok(waitIdx >= 0, "没有进入 waiting");
  const after = seq.slice(waitIdx + 1);
  assert.ok(
    after.some((s) => s.phase === "typing" && s.shown.length === 0),
    "删完之后没有重新开始打字"
  );
});

console.log("\n=== loop=false：只打一遍并停住 ===");
check("不循环时不会出现 deleting 阶段", () => {
  const seq = runSteps("abc", 30, { ...OPTS, loop: false });
  assert.ok(!seq.some((s) => s.phase === "deleting"), "不该进入删除阶段");
  const last = seq[seq.length - 1];
  assert.equal(last.shown, "abc", "应停在完整文本上");
});

check("不循环时下一步返回 continues=false", () => {
  let snap = initialSnapshot("ab");
  for (let i = 0; i < 10; i++) {
    const step = nextSnapshot(snap, "ab", { ...OPTS, loop: false });
    if (!step.continues) {
      assert.equal(snap.shown, "ab");
      return;
    }
    snap = step.next;
  }
  assert.fail("一直没结束");
});

console.log("\n=== 空文本 / 文本变化 ===");
check("空文本立即结束（loop=false）或停在空（loop=true 不崩）", () => {
  const empty = nextSnapshot(initialSnapshot(""), "", { ...OPTS, loop: false });
  assert.equal(empty.continues, false);
  // loop=true 时也不应抛错
  nextSnapshot(initialSnapshot(""), "", { ...OPTS, loop: true });
});

check("文本变化会重开一轮（shown 归零）", () => {
  const old = { forText: "旧的文字", shown: "旧的文字", phase: "holding" };
  const aligned = alignSnapshot(old, "新的");
  assert.equal(aligned.forText, "新的");
  assert.equal(aligned.shown, "");
  assert.equal(aligned.phase, "typing");
});

console.log("\n=== 光标可见性（打字和删除都要有光标）===");
check("打字中显示光标", () => {
  assert.equal(
    isTypingCursorVisible({ forText: "abc", shown: "a", phase: "typing" }),
    true
  );
});
check("删除中也要显示光标", () => {
  assert.equal(
    isTypingCursorVisible({ forText: "abc", shown: "ab", phase: "deleting" }),
    true
  );
});
check("删除到空（waiting）仍可显示光标", () => {
  assert.equal(
    isTypingCursorVisible({ forText: "abc", shown: "", phase: "waiting" }),
    true
  );
});
check("打完后停顿（holding）隐藏光标", () => {
  assert.equal(
    isTypingCursorVisible({ forText: "abc", shown: "abc", phase: "holding" }),
    false
  );
});
check("整个删除过程中光标始终可见", () => {
  const seq = runSteps("abcd", 40, { ...OPTS, loop: true });
  const deleting = seq.filter((s) => s.phase === "deleting");
  assert.ok(deleting.length > 0, "没有进入删除阶段");
  for (const s of deleting) {
    assert.equal(
      isTypingCursorVisible(s),
      true,
      `删除到 "${s.shown}" 时光标不应消失`
    );
  }
});
check("整个打字过程中光标始终可见", () => {
  const seq = runSteps("abcd", 40, { ...OPTS, loop: true });
  const typing = seq.filter((s) => s.phase === "typing");
  assert.ok(typing.length > 0, "没有打字阶段");
  for (const s of typing) {
    assert.equal(isTypingCursorVisible(s), true, `打字到 "${s.shown}" 时光标不应消失`);
  }
});

console.log("\n=== 停顿时长是否被尊重 ===");
check("holdAfterType 用作打完后到删除之间的延迟", () => {
  const step = nextSnapshot(
    { forText: "ab", shown: "ab", phase: "typing" },
    "ab",
    { holdAfterType: 1234, loop: true }
  );
  assert.equal(step.next.phase, "holding");
  assert.equal(step.delay, 1234);
});
check("holdAfterDelete 用作删完后到重打之间的延迟", () => {
  const step = nextSnapshot(
    { forText: "ab", shown: "", phase: "waiting" },
    "ab",
    { holdAfterDelete: 777, loop: true }
  );
  assert.equal(step.delay, 777);
  assert.equal(step.next.phase, "typing");
  assert.equal(step.next.shown, "");
});

console.log();
if (failures.length) {
  console.log(`[失败] ${failures.length} 项不通过（通过 ${pass} 项）：`);
  for (const f of failures) console.log("  -", f);
  process.exit(1);
}
console.log(`[通过] 打字机状态机全部 ${pass} 项断言通过`);
