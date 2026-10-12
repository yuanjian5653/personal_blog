/**
 * 日期 / 时间格式化
 * 以前每个页面各写一份 formatDate，共 12 处，现在统一到这里。
 */

/** 两位补零 */
function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** 把秒数格式化成 mm:ss */
export function formatTime(seconds: number): string {
  if (!seconds || !isFinite(seconds)) return "00:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${pad2(m)}:${pad2(s)}`;
}

/** 只输出 HH:mm:ss，用于时钟 */
export function formatClock(date: Date = new Date()): string {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(
    date.getSeconds()
  )}`;
}

/**
 * 日期字符串缩短格式：2025-10-12
 * 用于列表、相关文章的次要信息。
 */
export function formatDateShort(s: string): string {
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** 日期时间：2025-10-12 14:30 */
export function formatDateTime(s: string): string {
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return `${formatDateShort(s)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** 日期时间（带秒）：2025-10-12 14:30:05 */
export function formatDateTimeSeconds(s: string): string {
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return `${formatDateTime(s)}:${pad2(d.getSeconds())}`;
}

/** 中文日期：2025年10月12日 */
export function formatDateCN(s: string): string {
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

/** 中文日期时间：2025年10月12日 14:30 */
export function formatDateTimeCN(s: string): string {
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return `${formatDateCN(s)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** 点分日期：2025.10.12 */
export function formatDateDots(s: string): string {
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return `${d.getFullYear()}.${pad2(d.getMonth() + 1)}.${pad2(d.getDate())}`;
}

/**
 * 相对时间：刚刚 / N分钟前 / N小时前 / N天前，
 * 超过 30 天则按 `full` 指定的格式展示具体日期。
 *
 * @param full 超过 30 天时使用的完整日期格式，默认 "dots"（2025.10.12）
 */
export function relativeTime(
  s: string,
  full: "dots" | "short" | "cn" = "dots"
): string {
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;

  const diff = Date.now() - d.getTime();
  const min = Math.floor(diff / 60000);
  const hour = Math.floor(diff / 3600000);
  const day = Math.floor(diff / 86400000);

  if (min < 1) return "刚刚";
  if (min < 60) return `${min}分钟前`;
  if (hour < 24) return `${hour}小时前`;
  if (day < 30) return `${day}天前`;

  if (full === "short") return formatDateShort(s);
  if (full === "cn") return formatDateCN(s);
  return formatDateDots(s);
}
