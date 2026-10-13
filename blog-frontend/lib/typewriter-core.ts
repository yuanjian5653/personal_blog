/**
 * 打字机动画的纯状态机。
 *
 * 抽成纯函数是为了能被直接测试：动画最容易出错的地方是
 * 「删除阶段被跳过」这类时序问题，而那段逻辑不需要 React 就能验证。
 * React 侧只是用它 + setTimeout 驱动。
 */

export interface TypewriterOptions {
  /** 每个字的打出间隔（毫秒） */
  typeSpeed?: number;
  /** 每个字的删除间隔（毫秒） */
  deleteSpeed?: number;
  /** 打完整句后的停顿（毫秒） */
  holdAfterType?: number;
  /** 删完后的停顿（毫秒） */
  holdAfterDelete?: number;
  /** false 时只打一遍并停住，不进入删除循环 */
  loop?: boolean;
}

export type Phase = "typing" | "holding" | "deleting" | "waiting";

export interface TypewriterSnapshot {
  /** 这段动画属于哪段文本 */
  forText: string;
  /** 当前显示的文本 */
  shown: string;
  phase: Phase;
}

export interface TypewriterStep {
  /** 下一帧的状态 */
  next: TypewriterSnapshot;
  /** 距离下一帧的毫秒数 */
  delay: number;
  /** 是否还有后续动作（false = 动画已结束，应停住） */
  continues: boolean;
}

export const DEFAULT_TYPEWRITER_OPTIONS = {
  typeSpeed: 90,
  deleteSpeed: 45,
  holdAfterType: 2000,
  holdAfterDelete: 600,
  loop: true,
} as const;

/** 新建一个"从头开始打"的快照 */
export function initialSnapshot(text: string): TypewriterSnapshot {
  return { forText: text, shown: "", phase: "typing" };
}

/** 文本变了就重开一轮；没变则原样返回 */
export function alignSnapshot(
  snap: TypewriterSnapshot,
  text: string
): TypewriterSnapshot {
  return snap.forText === text ? snap : initialSnapshot(text);
}

/**
 * 计算下一帧。
 *
 * 关键点：整个过程只依赖传入的 snap，不读任何外部/闭包状态，
 * 因此不会出现"拿到过期 displayed 导致删除阶段被跳过"的问题。
 */
export function nextSnapshot(
  rawSnap: TypewriterSnapshot,
  text: string,
  options: TypewriterOptions = {}
): TypewriterStep {
  const {
    typeSpeed = DEFAULT_TYPEWRITER_OPTIONS.typeSpeed,
    deleteSpeed = DEFAULT_TYPEWRITER_OPTIONS.deleteSpeed,
    holdAfterType = DEFAULT_TYPEWRITER_OPTIONS.holdAfterType,
    holdAfterDelete = DEFAULT_TYPEWRITER_OPTIONS.holdAfterDelete,
    loop = DEFAULT_TYPEWRITER_OPTIONS.loop,
  } = options;

  const snap = alignSnapshot(rawSnap, text);
  const { shown, phase } = snap;

  const stay = (patch: Partial<Omit<TypewriterSnapshot, "forText">>, delay: number): TypewriterStep => ({
    next: { forText: text, shown: patch.shown ?? shown, phase: patch.phase ?? phase },
    delay,
    continues: true,
  });

  switch (phase) {
    case "typing":
      if (shown.length < text.length) {
        return stay({ shown: text.slice(0, shown.length + 1) }, typeSpeed);
      }
      if (!loop) {
        // 不循环：打完就停住，没有后续
        return { next: snap, delay: 0, continues: false };
      }
      return stay({ phase: "holding" }, holdAfterType);

    case "holding":
      return stay({ phase: "deleting" }, 0);

    case "deleting":
      if (shown.length > 0) {
        return stay({ shown: shown.slice(0, -1) }, deleteSpeed);
      }
      return stay({ phase: "waiting" }, 0);

    case "waiting":
    default:
      return { next: initialSnapshot(text), delay: holdAfterDelete, continues: true };
  }
}

/** 当前是否应该显示光标。
 *
 * 打字和删除两个阶段都要有光标 —— 删除时没有光标会显得像是"字被吞掉了"
 * 而不是"正在退格"。只有整句完整显示（打完了、还没开始删）时才隐藏。
 */
export function isTypingCursorVisible(snap: TypewriterSnapshot): boolean {
  // 已完整显示且处于停顿：此时不需要光标
  if (snap.phase === "holding") return false;
  // 打字 / 删除阶段都显示
  return true;
}
