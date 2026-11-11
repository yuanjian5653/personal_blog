"use client";

/**
 * 颜色选择器。
 *
 * 为什么不直接写 `<input type="color">` + CSS：
 *
 *   `.admin-field` 是 `display: flex; flex-direction: column`，
 *   子项默认 `align-items: stretch`，会把色块沿**交叉轴**（横向）
 *   拉成一条横线。CSS 里用 `align-self: flex-start` 能治，
 *   但样式层叠（Tailwind 的 layer、其它页面的通用 input 规则）
 *   随时可能把它盖回去 —— 事实上已经盖回去过一次。
 *
 *   所以这里用**内联样式**：优先级最高，不会被任何规则覆盖；
 *   而且"这个控件自身就该长这样"本来就是组件自己的事，
 *   放在组件里比散在 CSS 里更不容易被改坏。
 */
export default function ColorInput({
  value,
  onChange,
  title,
}: {
  value: string;
  onChange: (next: string) => void;
  title?: string;
}) {
  return (
    <input
      type="color"
      value={value || "#000000"}
      title={title}
      onChange={(e) => onChange(e.target.value)}
      style={{
        width: 46,
        height: 32,
        // 关键：阻止 column flex 的横向拉伸
        alignSelf: "flex-start",
        flex: "none",
        padding: 2,
        borderRadius: 8,
        border: "1px solid var(--adm-border)",
        background: "transparent",
        cursor: "pointer",
        boxSizing: "border-box",
      }}
    />
  );
}
