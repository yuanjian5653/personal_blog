"use client";

/**
 * 审核状态徽章（后台列表用）
 *
 * 成员最关心的一件事："我发的东西现在到底什么状态？"
 * 所以列表里必须能一眼看到，且驳回时把理由直接写出来，
 * 而不是让 ta 去猜或私下来问。
 */

export type ReviewStatus = "none" | "pending" | "approved" | "rejected";

const META: Record<
  ReviewStatus,
  { label: string; bg: string; color: string }
> = {
  none: { label: "未审核", bg: "rgba(148,163,184,0.16)", color: "#94a3b8" },
  pending: {
    label: "审核中",
    bg: "rgba(250,204,21,0.16)",
    color: "#facc15",
  },
  approved: {
    label: "已通过",
    bg: "rgba(34,197,94,0.16)",
    color: "#4ade80",
  },
  rejected: {
    label: "已驳回",
    bg: "rgba(248,113,113,0.16)",
    color: "#f87171",
  },
};

interface Props {
  status?: string | null;
  /** 驳回理由（review_note）。只在 rejected 时显示 */
  note?: string | null;
}

export default function ReviewStatusBadge({ status, note }: Props) {
  const key = (
    ["none", "pending", "approved", "rejected"].includes(status ?? "")
      ? status
      : "approved"
  ) as ReviewStatus;
  const meta = META[key];

  return (
    <>
      <span
        className="text-[10px] px-1.5 py-0.5 rounded"
        style={{ background: meta.bg, color: meta.color }}
        title={
          key === "pending"
            ? "已提交，等待管理员审核；通过后才会出现在前台"
            : key === "rejected"
              ? "未通过审核，修改后重新提交"
              : undefined
        }
      >
        {meta.label}
      </span>
      {key === "rejected" && note ? (
        <span
          className="text-[10px] px-1.5 py-0.5 rounded"
          style={{ background: "rgba(248,113,113,0.08)", color: "#f87171" }}
          title={note}
        >
          理由：{note}
        </span>
      ) : null}
    </>
  );
}
