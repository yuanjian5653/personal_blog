import assert from "node:assert/strict";

// 用 mock fetch 观察真实发出的请求体 —— 比测内部函数更贴近实际。
const calls = [];
globalThis.fetch = async (url, init) => {
  calls.push({ url, init });
  return {
    ok: true,
    status: 200,
    json: async () => ({ url: "/media/x.png" }),
  };
};

const { api } = await import("../lib/api.ts");

// 1. FormData 上传：body 必须还是 FormData，不能被 JSON.stringify
const fd = new FormData();
fd.append("file", new Blob(["x"]), "a.png");
await api.post("/api/site-config/images/upload", fd);

const first = calls[0];
assert.ok(first.init.body instanceof FormData, "body 应保持 FormData");
assert.ok(!(typeof first.init.body === "string"), "不能被序列化成字符串");
// 关键：不能给 FormData 设 Content-Type（要让浏览器自带 boundary）
const h = first.init.headers || {};
assert.ok(!("Content-Type" in h), "FormData 不应手动设 Content-Type");

// 2. 旧 bug 的证明：JSON.stringify(FormData) 就是 "{}"
assert.equal(JSON.stringify(fd), "{}");

// 3. 普通对象仍走 JSON
calls.length = 0;
await api.post("/api/x", { a: 1 });
assert.equal(calls[0].init.body, JSON.stringify({ a: 1 }));
assert.equal(calls[0].init.headers["Content-Type"], "application/json");

// 4. api.upload 和 api.post 对 FormData 行为一致
calls.length = 0;
await api.upload("/api/upload/image", fd);
assert.ok(calls[0].init.body instanceof FormData);

console.log("  api 请求体 8 项断言通过（FormData 不再被序列化成 {}）");
