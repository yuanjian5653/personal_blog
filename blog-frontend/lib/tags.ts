/**
 * 文章标签处理
 *
 * 后端把 tags 存成一个逗号分隔的字符串，前端多处需要拆成数组
 * （列表页筛选、卡片展示、标签统计）。这段 split/trim/filter
 * 以前重复了 6 次，统一到这里。
 */

/**
 * 把 "mysql, python , 后端" 拆成 ["mysql", "python", "后端"]。
 * 自动去掉空白项和首尾空格。
 *
 * @param tags 逗号分隔的标签字符串，可能为 null
 * @param limit 最多返回几个（用于卡片上只显示前 N 个）
 */
export function parseTags(
  tags: string | null | undefined,
  limit?: number
): string[] {
  if (!tags) return [];
  const list = tags
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  return limit === undefined ? list : list.slice(0, limit);
}
