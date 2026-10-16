"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { login } from "@/lib/auth";

export default function AdminLoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(username, password);
      // 登录成功跳转仪表盘
      router.push("/admin/dashboard");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="admin-login-card">
      <h1>管理员登录</h1>
      <p className="admin-login-card__sub">登录后进入后台管理</p>

      <div className="admin-login-field">
        <label htmlFor="admin-username">用户名</label>
        <input
          id="admin-username"
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="请输入用户名"
          autoComplete="username"
          required
        />
      </div>

      <div className="admin-login-field">
        <label htmlFor="admin-password">密码</label>
        <input
          id="admin-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="请输入密码"
          autoComplete="current-password"
          required
        />
      </div>

      {error && <div className="admin-login-error">{error}</div>}

      <button type="submit" disabled={loading} className="admin-login-submit">
        {loading ? "登录中…" : "登录"}
      </button>
    </form>
  );
}