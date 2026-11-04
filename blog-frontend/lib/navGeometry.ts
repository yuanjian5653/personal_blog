/**
 * 导航栏「液体指示器」的几何计算。
 *
 * 抽成纯函数的原因：这段逻辑踩过一个很隐蔽的坑，而它只在浏览器里
 * 才能暴露（offsetLeft 依赖真实布局），CI 里没有布局引擎。
 * 抽出来之后就能用假对象把"该量哪个元素"这件事钉死。
 *
 * 坑的由来：
 *   `.nav-island__item`（<li>）如果设了 position: relative，
 *   那么里面 <a> 的 offsetParent 就是它自己的 <li>，
 *   `a.offsetLeft` 恒为 0 —— 指示器永远贴在轨道最左端，
 *   切换页面时看起来"选中框不跟着动"。
 *   所以必须量 <li> 本身（它的 offsetParent 才是 .nav-island__track）。
 */

export interface LiquidGeometry {
  /** 相对导航轨道左边缘的偏移（px） */
  x: number;
  /** 指示器宽度（px） */
  w: number;
}

/** 只取我们真正用到的两个只读属性，方便构造假对象做测试 */
export interface Measurable {
  offsetLeft: number;
  offsetWidth: number;
  parentElement: Measurable | null;
}

export interface TrackLike {
  querySelector(selectors: string): Measurable | null;
}

export const ACTIVE_SELECTOR = '[data-active="true"]';

/**
 * 从导航轨道里算出活动项的指示器几何。
 *
 * 返回 null 的三种情况：
 *   1. 轨道不存在（组件已卸载）
 *   2. 没有活动项（理论上不会，兜底）
 *   3. 活动项宽度为 0 —— 说明轨道被 CSS 隐藏了（移动端收进汉堡菜单），
 *      此时不应该渲染指示器
 */
export function resolveLiquidGeometry(
  track: TrackLike | null | undefined
): LiquidGeometry | null {
  if (!track) return null;

  const link = track.querySelector(ACTIVE_SELECTOR);
  if (!link) return null;

  // 关键：量父元素 <li>，不要量 <a>
  const item = link.parentElement;
  if (!item || item.offsetWidth === 0) return null;

  return { x: item.offsetLeft, w: item.offsetWidth };
}
