/**
 * 图片 URL 处理
 * 后端返回的图片字段有三种形态，需要统一处理：
 *   1. 完整 URL（http/https）      → 原样使用
 *   2. 站内绝对路径（/media/...）  → 拼接后端地址
 *   3. 裸文件名（abc123.jpg）      → 按 media/photos/ 下的文件处理
 *
 * 这段逻辑以前在 8 个文件里各复制了一份，现在只保留这一处。
 */
import { API_BASE } from "./api";

/**
 * 把后端返回的图片字段解析成浏览器可直接使用的 URL。
 *
 * @param path 后端返回的图片路径
 * @param prefix 裸文件名所在的媒体子目录，默认 "photos"
 * @returns 可直接用于 <img src> 的 URL；path 为空时返回 ""
 */
export function resolveImageUrl(
  path: string | null | undefined,
  prefix = "photos"
): string {
  if (!path) return "";
  if (path.startsWith("http")) return path;
  if (path.startsWith("/")) return `${API_BASE}${path}`;
  return `${API_BASE}/media/${prefix}/${path}`;
}

/** 解析 media/thumbs/ 下的缩略图 URL */
export function resolveThumbUrl(path: string | null | undefined): string {
  return resolveImageUrl(path, "thumbs");
}

/**
 * 网易云等外部图片地址可能是 http://，浏览器会拦截混合内容。
 * 统一升级成 https://。
 */
export function toHttpsUrl(url: string | null | undefined): string {
  if (!url) return "";
  return url.startsWith("http://")
    ? url.replace("http://", "https://")
    : url;
}
