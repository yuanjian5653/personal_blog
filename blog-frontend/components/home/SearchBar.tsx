"use client";

export default function SearchBar() {
  return (
    <div className="w-full max-w-xl mx-auto">
      <div
        className="flex items-center gap-3 h-12 px-5 rounded-full"
        style={{
          background: "rgba(255, 255, 255, 0.1)",
          backdropFilter: "blur(20px) saturate(180%)",
          WebkitBackdropFilter: "blur(20px) saturate(180%)",
          border: "1px solid rgba(255, 255, 255, 0.15)",
          boxShadow: "inset 1.5px 1.5px 0 0 rgba(255,255,255,0.2), inset -1px -1px 0 0 rgba(255,255,255,0.05), 0 1px 2px rgba(0,0,0,0.1), 0 12px 28px -10px rgba(0,0,0,0.3)",
        }}
      >
        <svg
          className="w-5 h-5 flex-shrink-0"
          style={{ color: "var(--text-secondary)" }}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          placeholder="输入暗号探索更多..."
          className="flex-1 bg-transparent border-none outline-none text-sm"
          style={{ color: "var(--text-primary)" }}
        />
      </div>
    </div>
  );
}