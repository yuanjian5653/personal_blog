"use client";

import ProfileForm from "@/components/admin/ProfileForm";
import { useRole } from "@/lib/useRole";

/**
 * 关于内容（一个页面，两种数据源）
 *
 *   管理员 → mode="site" → 站点级配置（site_config）
 *   成员   → mode="self" → 自己的档案（author_profiles）
 *
 * 两种模式共用 ProfileForm：字段定义、版式、图片选择器都只有一份，
 * 差别只是「存到哪、字段叫什么名」（见组件里的 KEY_MAP）。
 */
export default function ProfilePage() {
  const role = useRole();
  return <ProfileForm mode={role === "member" ? "self" : "site"} />;
}
