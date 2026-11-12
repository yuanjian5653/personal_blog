
import assert from "node:assert/strict";

const { formatDetail } = await import("../lib/api.ts");

// 1. 字符串 detail 原样返回
assert.equal(formatDetail("密码至少 8 位"), "密码至少 8 位");

// 2. 422 数组（真实形态：改密码太短）
const pw = [{
  type: "string_too_short",
  loc: ["body", "new_password"],
  msg: "String should have at least 12 characters",
  input: "1",
  ctx: { min_length: 12 },
}];
assert.equal(formatDetail(pw), "new_password: 至少 12 个字符");

// 3. 上传缺字段
const up = [{ type: "missing", loc: ["body", "file"], msg: "Field required", input: null }];
assert.equal(formatDetail(up), "file: 必填");

// 4. 多条去重拼接
const multi = [
  { loc: ["body", "a"], msg: "Field required" },
  { loc: ["body", "b"], msg: "Field required" },
];
assert.equal(formatDetail(multi), "a: 必填；b: 必填");

// 5. 对象 detail
assert.equal(formatDetail({ message: "服务器开小差了" }), "服务器开小差了");

// 6. 猜不出来的消息不要吞，原样给
assert.equal(formatDetail([{ loc: ["body", "x"], msg: "Some weird error" }]), "x: Some weird error");

// 7. 关键：绝不能出现 [object Object]
for (const d of ["abc", pw, up, multi, { message: "m" }, [{ foo: 1 }]]) {
  const out = formatDetail(d);
  assert.ok(!out.includes("[object Object]"), "不能出现 [object Object]，实际：" + out);
}

console.log("  formatDetail 7 项断言通过");
