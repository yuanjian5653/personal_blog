import { api } from "./api";

/**
 * 后台成员（管理员 / 成员）管理。
 *
 * 与后端 routers/members.py 一一对应。数量少（个人站），
 * 所以不做分页，直接一次取全量。
 */

export type MemberRole = "admin" | "member";
export type MemberStatus = "active" | "pending" | "disabled";

export interface Member {
  id: number;
  username: string;
  display_name: string | null;
  role: MemberRole;
  status: MemberStatus;
  upload_quota: number | null;
  /** None = 跟随全局；true 必审；false 免审 */
  need_review: boolean | null;
  /** 本地音乐上传上限；null = 用默认值，0 = 不限 */
  music_quota: number | null;
  /** 能不能用网易云；null = 用默认值 */
  netease_enabled: boolean | null;
  /** 是否允许用 GitHub 同步项目 */
  github_enabled: boolean | null;
  /** 只读：配没配自己的 GitHub Token */
  has_github_token: boolean;
  /** 只读：配没配自己的网易云 Cookie */
  has_netease_cookie: boolean;
  last_login_at: string | null;
  created_at: string;
  content_count: number;
  /** 后端算好的：当前登录者能不能改这一行（自己那行为 false） */
  editable: boolean;
}

export interface MemberCreateInput {
  username: string;
  password: string;
  display_name?: string;
  role: MemberRole;
  upload_quota?: number | null;
  need_review?: boolean | null;
  music_quota?: number | null;
  netease_enabled?: boolean | null;
}

export interface MemberUpdateInput {
  username?: string;
  display_name?: string;
  role?: MemberRole;
  status?: MemberStatus;
  upload_quota?: number | null;
  need_review?: boolean | null;
  /** 本地音乐上传上限（0 = 不限） */
  music_quota?: number | null;
  /** 是否允许用网易云 */
  netease_enabled?: boolean | null;
  /** 是否允许用 GitHub 同步项目 */
  github_enabled?: boolean | null;
}

export interface MemberCreated {
  member: Member;
  /** 初始密码只在创建时返回一次，数据库里只有 bcrypt 哈希 */
  password: string;
}

export const ROLE_HINT: Record<MemberRole, string> = {
  admin: "拥有全部权限：成员管理、审核、站点配置、订阅与日志",
  member: "只能管理自己的文章 / 说说 / 动态 / 图片 / 友链",
};

export function emptyMemberInput(): MemberCreateInput {
  return {
    username: "",
    password: "",
    display_name: "",
    role: "member",
    upload_quota: 30,
  };
}

export const fetchMembers = () => api.get<Member[]>("/api/admin/members");

export const createMember = (input: MemberCreateInput) =>
  api.post<MemberCreated>("/api/admin/members", input);

export const updateMember = (id: number, input: MemberUpdateInput) =>
  api.put<Member>(`/api/admin/members/${id}`, input);

export const resetMemberPassword = (id: number, newPassword: string) =>
  api.post<{ message: string }>(`/api/admin/members/${id}/password`, {
    new_password: newPassword,
  });

export const deleteMember = (id: number) =>
  api.delete<{ message: string; username: string }>(`/api/admin/members/${id}`);
