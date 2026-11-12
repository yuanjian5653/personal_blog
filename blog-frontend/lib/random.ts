/**
 * 由整数种子生成 [0,1) 的伪随机数（确定性）。
 *
 * 用途：给同一份数据每次渲染都得到相同的"随机"值 —— 比如照片卡片
 * 的轻微旋转角度、纸条的倾斜。用 Math.random() 会导致每次渲染都变，
 * 看起来像在抖。
 *
 * 这个函数原来在 app/photos/[id]/page.tsx 和 components/life/LifeDetail.tsx
 * 各有一份一模一样的实现，抽到这里。
 *
 * 注意：lib/friendlinks.ts 里那个叫 seededRandom 的函数**算法不同**
 * （用于布局抖动的另一套参数），已经改名为 seededUnit，别再混。
 */
export function seededRandom(seed: number): number {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}
