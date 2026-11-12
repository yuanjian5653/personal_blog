/**
 * API 客户端封装
 * 统一处理：拼接后端地址、自动携带 Cookie、解析 JSON 和错误
 */

/**
 * 后端地址（末尾不带斜杠）。
 * 全站唯一来源：以前有 29 个文件各自复制了一份这段逻辑。
 */
export const API_BASE = (
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000"
).replace(/\/$/, "");

/** 把后端返回的相对路径（/media/... ）拼成完整 URL；已是绝对 URL 的原样返回 */
export function withApiBase(path: string): string {
  if (!path) return "";
  if (/^https?:\/\//.test(path)) return path;
  return path.startsWith("/") ? `${API_BASE}${path}` : `${API_BASE}/${path}`;
}

/**
 * 把后端返回的 `detail` 转成能直接给用户看的字符串。
 *
 * 为什么需要这个：
 *   FastAPI 的错误体有两种形状 ——
 *     · 业务错误：{"detail": "密码至少 8 位"}          → detail 是字符串
 *     · 校验错误（422）：{"detail": [{"loc": [...], "msg": "..."}]}
 *                                                        → detail 是**数组**
 *   如果直接把数组塞进 `new Error(...)`，`err.message` 就是
 *   String(数组)，元素是对象时显示成 "[object Object]" ——
 *   用户根本不知道哪一步错了（改密码、传头像时都踩过）。
 */
/**
 * Pydantic 的校验消息是英文的，直接甩给用户很别扭。
 * 只翻译最常见的那几条，翻不了的原样返回（宁可英文也别吞掉信息）。
 */
function localizeMsg(msg: string): string {
  const rules: [RegExp, (m: RegExpMatchArray) => string][] = [
    [/^String should have at least (\d+) characters?$/i, (m) => `至少 ${m[1]} 个字符`],
    [/^String should have at most (\d+) characters?$/i, (m) => `最多 ${m[1]} 个字符`],
    [/^Field required$/i, () => "必填"],
    [/^Input should be a valid integer/i, () => "必须是整数"],
    [/^Input should be a valid string/i, () => "必须是文本"],
    [/^Input should be a valid boolean/i, () => "必须是布尔值"],
    [/^Invalid email/i, () => "邮箱格式不正确"],
    [/^Input should be a valid URL/i, () => "网址格式不正确"],
    [/value is not a valid (\w+)/i, (m) => `不是合法的 ${m[1]}`],
  ];
  for (const [re, build] of rules) {
    const m = msg.match(re);
    if (m) return build(m);
  }
  return msg;
}

export function formatDetail(detail: unknown): string {
  if (typeof detail === "string") return detail;

  if (Array.isArray(detail)) {
    const parts = detail.map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object") {
        const d = item as { msg?: unknown; loc?: unknown };
        const msg = typeof d.msg === "string" ? d.msg : "";
        // loc 形如 ["body", "password"]，去掉 body/query 这类前缀
        const field = Array.isArray(d.loc)
          ? d.loc
              .filter((x) => x !== "body" && x !== "query" && x !== "path")
              .map(String)
              .join(".")
          : "";
        if (msg) {
          const zh = localizeMsg(msg);
          return field ? `${field}: ${zh}` : zh;
        }
        return JSON.stringify(item);
      }
      return String(item);
    });
    // 同一字段可能报多条，去重后再拼
    return Array.from(new Set(parts.filter(Boolean))).join("；");
  }

  if (detail && typeof detail === "object") {
    const msg = (detail as { message?: unknown }).message;
    if (typeof msg === "string") return msg;
    return JSON.stringify(detail);
  }

  return String(detail);
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE}${path}`;

  const response = await fetch(url, {
    ...init,
    credentials: "include",
    headers: {
      ...(init.body && !(init.body instanceof FormData)
        ? { "Content-Type": "application/json" }
        : {}),
      ...init.headers,
    },
  });

  if (!response.ok) {
    let message = `请求失败 (${response.status})`;
    try {
      const data = await response.json();
      if (data?.detail !== undefined) message = formatDetail(data.detail);
    } catch {
      // 响应体不是 JSON（比如 nginx 的 HTML 错误页），保留状态码提示
    }
    throw new Error(message);
  }

  if (response.status === 204) return undefined as T;

  return response.json() as Promise<T>;
}

/**
 * 组装请求体。
 *
 * 关键：FormData **绝对不能** JSON.stringify ——
 * `JSON.stringify(new FormData())` 得到的是字符串 "{}"，
 * 文件会被整个丢掉，后端只收到一个空 JSON，报「file: 必填」。
 * 这个坑一开始出现在 ImagePicker（背景图/头像上传）。
 * 这里统一兜住：只要是 FormData 就原样传，让浏览器自己带 boundary。
 */
function makeBody(body: unknown, method: "POST" | "PUT"): RequestInit {
  if (body === undefined || body === null) return { method };
  if (body instanceof FormData) return { method, body };
  return { method, body: JSON.stringify(body) };
}

export const api = {
  get: <T>(path: string) => apiFetch<T>(path),
  post: <T>(path: string, body?: unknown) =>
    apiFetch<T>(path, makeBody(body, "POST")),
  put: <T>(path: string, body?: unknown) =>
    apiFetch<T>(path, makeBody(body, "PUT")),
  delete: <T>(path: string) => apiFetch<T>(path, { method: "DELETE" }),
  /** 表单上传（图片 / 音频 / 文档）。走 apiFetch，错误格式和别处一致 */
  upload: <T>(path: string, formData: FormData) =>
    apiFetch<T>(path, { method: "POST", body: formData }),
};