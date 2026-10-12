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
    <div className="min-h-[70vh] flex items-center justify-center">
      <form onSubmit={handleSubmit} className="glass p-8 w-full max-w-sm space-y-5">
        <h1 className="text-xl font-bold text-center">管理员登录</h1>

        <div>
          <label className="block text-xs mb-2" style={{ color: "var(--text-secondary)" }}>
            用户名
          </label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 focus:border-[var(--accent)] outline-none text-sm"
          />
        </div>

        <div>
          <label className="block text-xs mb-2" style={{ color: "var(--text-secondary)" }}>
            密码
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 focus:border-[var(--accent)] outline-none text-sm"
          />
        </div>

        {error && (
          <div className="text-xs px-3 py-2 rounded" style={{ color: "#f87171", background: "rgba(248,113,113,0.1)" }}>
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full py-2 rounded-lg text-sm font-medium disabled:opacity-50"
          style={{ background: "var(--accent)", color: "#fff" }}
        >
          {loading ? "登录中..." : "登录"}
        </button>
      </form>
    </div>
  );
}