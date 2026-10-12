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
    let detail = `请求失败 (${response.status})`;
    try {
      const data = await response.json();
      if (data?.detail) detail = data.detail;
    } catch {}
    throw new Error(detail);
  }

  if (response.status === 204) return undefined as T;

  return response.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => apiFetch<T>(path),
  post: <T>(path: string, body?: unknown) =>
    apiFetch<T>(path, {
      method: "POST",
      body: body ? JSON.stringify(body) : undefined,
    }),
  put: <T>(path: string, body?: unknown) =>
    apiFetch<T>(path, {
      method: "PUT",
      body: body ? JSON.stringify(body) : undefined,
    }),
  delete: <T>(path: string) => apiFetch<T>(path, { method: "DELETE" }),
};