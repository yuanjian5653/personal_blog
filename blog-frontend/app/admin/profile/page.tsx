"use client";

import MyProfileForm from "@/components/admin/MyProfileForm";
import SiteProfileForm from "@/components/admin/SiteProfileForm";
import { useRole } from "@/lib/useRole";

/**
 * 关于内容（一个页面，两种数据源）
 *
 *   管理员 → 站点级配置（site_config）：首页那张个人卡片用的就是它
 *   成员   → 自己的档案（author_profiles）：各一份，互不影响
 *
 * 为什么用薄壳分派而不是在页面里 if：
 *   页面里 if 会让后面的 Hook 变成"条件调用"，ESLint 的
 *   rules-of-hooks 直接报错；拆成两个组件、外层只调一个 useRole 最干净。
 */
export default function ProfilePage() {
  const role = useRole();
  return role === "member" ? <MyProfileForm /> : <SiteProfileForm />;
}
