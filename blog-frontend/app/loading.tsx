/**
 * 路由切换时的加载界面。
 *
 * 为什么需要它：本站内容全是客户端拉取（CSR），点导航后新页面的 JS 要加载、
 * 数据要请求，这段空档期原来是一片空白 —— 再叠上 .page-enter 从 opacity:0
 * 淡入 0.65s，观感就是"闪一下才出来"。
 * loading.tsx 是 App Router 的原生机制：导航一开始就立刻显示它，
 * 新内容准备好后自动替换，用户看到的是"正在加载"而不是白屏。
 *
 * 保持克制：一个细圆环 + 一行小字，不加骨架屏 ——
 * 骨架只对固定结构有意义，而这里的页面结构差异很大。
 */
export default function Loading() {
  return (
    <div className="route-loading" role="status" aria-live="polite">
      <span className="route-loading__ring" aria-hidden="true" />
      <span className="route-loading__text">加载中</span>
    </div>
  );
}
