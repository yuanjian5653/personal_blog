export default function AdminToolsPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">工具管理</h1>
      <div
        className="glass p-16 text-center text-sm"
        style={{ color: "var(--text-secondary)" }}
      >
        工具功能开发中
        <br />
        <span className="text-xs opacity-70">
          前台 /tools 页面目前显示「开发中」，等工具有了再在这里加管理
        </span>
      </div>
    </div>
  );
}
