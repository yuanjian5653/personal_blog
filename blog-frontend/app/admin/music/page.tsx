"use client";

import { useEffect, useRef, useState } from "react";
import { api, API_BASE } from "@/lib/api";
import type { NeteaseAccount, NeteasePlaylist } from "@/lib/types";
import { getCoverUrl } from "@/lib/types";
import { toHttpsUrl } from "@/lib/url";

/* ========== 类型 ========== */
interface LocalSong {
  id: number;
  title: string;
  artist: string;
  album: string;
  duration: number;
  cover_path: string | null;
  created_at: string;
}

/* ========== 本地音乐区块 ========== */
function LocalSection() {
  // null = 尚未加载完；loading 由它派生，避免在 effect 里同步 setState
  const [songs, setSongs] = useState<LocalSong[] | null>(null);
  const loading = songs === null;
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [keyword, setKeyword] = useState("");
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = () => {
    api
      .get<LocalSong[]>("/api/music/songs")
      .then(setSongs)
      .catch(() => setSongs([]));
  };

  useEffect(() => {
    load();
  }, []);

  // 上传
  const handleUpload = async (files: FileList) => {
    if (files.length === 0) return;
    setUploading(true);
    setMsg(null);
    try {
      const formData = new FormData();
      for (let i = 0; i < files.length; i++) {
        formData.append("files", files[i]);
      }
      const res = await fetch(`${API_BASE}/api/music/upload`, {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `上传失败 (${res.status})`);
      }
      const created = await res.json();
      setMsg(`上传成功 ${created.length} 首`);
      load();
    } catch (e) {
      setMsg(`上传失败：${(e as Error).message}`);
    } finally {
      setUploading(false);
    }
  };

  // 删除
  const handleDelete = async (song: LocalSong, deleteFile: boolean) => {
    const tip = deleteFile
      ? `确定删除「${song.title}」？会同时删除磁盘文件，不可恢复。`
      : `确定从数据库移除「${song.title}」？磁盘文件保留。`;
    if (!confirm(tip)) return;
    setDeletingId(song.id);
    try {
      await api.delete(
        `/api/music/songs/${song.id}?delete_file=${deleteFile}`
      );
      setSongs((prev) => (prev ?? []).filter((s) => s.id !== song.id));
    } catch (e) {
      alert(`删除失败：${(e as Error).message}`);
    } finally {
      setDeletingId(null);
    }
  };

  // 手动扫描
  const handleScan = async () => {
    setMsg("扫描中...");
    try {
      const res = await api.post<{ stats: { added: number; removed: number; total: number } }>(
        "/api/music/scan"
      );
      setMsg(
        `扫描完成：新增 ${res.stats.added}，移除 ${res.stats.removed}，总计 ${res.stats.total}`
      );
      load();
    } catch (e) {
      setMsg(`扫描失败：${(e as Error).message}`);
    }
  };

  // 窄化类型：过滤只在数据到位后进行
  const allSongs = songs ?? [];
  const filtered = keyword
    ? allSongs.filter(
        (s) =>
          s.title.toLowerCase().includes(keyword.toLowerCase()) ||
          s.artist.toLowerCase().includes(keyword.toLowerCase())
      )
    : allSongs;

  return (
    <div className="space-y-4">
      {/* 操作栏 */}
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="px-4 py-2 rounded-lg text-sm disabled:opacity-50"
          style={{ background: "var(--adm-blue)", color: "#fff" }}
        >
          {uploading ? "上传中..." : "+ 上传音乐"}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) handleUpload(e.target.files);
            e.target.value = "";
          }}
        />

        <button
          onClick={handleScan}
          className="admin-input"
        >
          手动扫描目录
        </button>

        <input
          type="text"
          placeholder="搜索歌曲..."
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          className="admin-input"
        />
      </div>

      {msg && (
        <div
          className="text-sm px-4 py-2 rounded-lg"
          style={{
            background: msg.includes("失败")
              ? "rgba(248,113,113,0.1)"
              : "rgba(34,197,94,0.1)",
            color: msg.includes("失败") ? "#f87171" : "#4ade80",
          }}
        >
          {msg}
        </div>
      )}

      {/* 歌曲列表 */}
      {loading ? (
        <div style={{ color: "var(--text-secondary)" }}>加载中...</div>
      ) : filtered.length === 0 ? (
        <div
          className="glass p-16 text-center text-sm"
          style={{ color: "var(--text-secondary)" }}
        >
          {allSongs.length === 0 ? "还没有本地音乐，点上方上传" : "没有匹配的歌曲"}
        </div>
      ) : (
        <div className="glass p-2">
          {filtered.map((song, i) => (
            <div
              key={song.id}
              className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/5 transition-colors group"
            >
              <span
                className="w-6 text-center text-xs tabular-nums"
                style={{ color: "var(--text-secondary)" }}
              >
                {String(i + 1).padStart(2, "0")}
              </span>

              <img
                src={getCoverUrl(song)}
                alt=""
                className="w-10 h-10 rounded object-cover bg-white/5 flex-shrink-0"
                onError={(e) =>
                  ((e.target as HTMLImageElement).style.visibility = "hidden")
                }
              />

              <div className="flex-1 min-w-0">
                <div className="text-sm truncate">{song.title}</div>
                <div
                  className="text-xs truncate"
                  style={{ color: "var(--text-secondary)" }}
                >
                  {song.artist}
                </div>
              </div>

              {/* 删除按钮 */}
              <div className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
                <button
                  onClick={() => handleDelete(song, false)}
                  disabled={deletingId === song.id}
                  className="text-xs px-2 py-1 rounded hover:bg-white/10"
                  title="只删数据库记录"
                >
                  移除
                </button>
                <button
                  onClick={() => handleDelete(song, true)}
                  disabled={deletingId === song.id}
                  className="text-xs px-2 py-1 rounded"
                  style={{ color: "#f87171" }}
                  title="同时删除磁盘文件"
                >
                  彻底删除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ========== 网易云区块 ========== */
function NeteaseSection() {
  const [account, setAccount] = useState<NeteaseAccount | null>(null);
  const [playlists, setPlaylists] = useState<NeteasePlaylist[]>([]);
  // account 本身可能为 null（未登录），所以用一个独立的标志表示"加载完成"
  const [loaded, setLoaded] = useState(false);
  const loading = !loaded;
  const [cookieInput, setCookieInput] = useState("");
  const [savingCookie, setSavingCookie] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // 前台显示的歌单配置
  const [configPlaylistId, setConfigPlaylistId] = useState("");
  const [configPlaylistName, setConfigPlaylistName] = useState("");
  const [savingPlaylist, setSavingPlaylist] = useState(false);

  const load = () => {
    Promise.all([
      api.get<NeteaseAccount>("/api/netease/account"),
      api.get<{ playlists: NeteasePlaylist[] }>("/api/netease/my-playlists"),
      api.get<{ configs: Record<string, string> }>("/api/site-config"),
    ])
      .then(([acc, pls, cfg]) => {
        setAccount(acc);
        setPlaylists(pls.playlists);
        setConfigPlaylistId(cfg.configs.netease_playlist_id || "");
        setConfigPlaylistName(cfg.configs.netease_playlist_name || "");
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  };

  useEffect(() => {
    load();
  }, []);

  // 保存 cookie
  const handleSaveCookie = async () => {
    if (!cookieInput.trim()) {
      setMsg("请粘贴 MUSIC_U 值");
      return;
    }
    setSavingCookie(true);
    setMsg(null);
    try {
      const res = await api.post<{
        success: boolean;
        nickname: string;
        avatar: string;
      }>("/api/netease/cookie", { music_u: cookieInput.trim() });
      setMsg(`Cookie 已保存并验证成功，账号：${res.nickname}`);
      setCookieInput("");
      load();
    } catch (e) {
      setMsg(`保存失败：${(e as Error).message}`);
    } finally {
      setSavingCookie(false);
    }
  };

  // 保存歌单配置
  const handleSavePlaylist = async () => {
    setSavingPlaylist(true);
    setMsg(null);
    try {
      const found = playlists.find((p) => String(p.id) === configPlaylistId);
      await api.put("/api/site-config", {
        configs: {
          netease_playlist_id: configPlaylistId,
          netease_playlist_name: found?.name || "",
        },
      });
      setConfigPlaylistName(found?.name || "");
      setMsg(`已设置为前台显示：${found?.name || "无"}`);
    } catch (e) {
      setMsg(`保存失败：${(e as Error).message}`);
    } finally {
      setSavingPlaylist(false);
    }
  };

  if (loading) return <div style={{ color: "var(--text-secondary)" }}>加载中...</div>;

  return (
    <div className="space-y-6">
      {msg && (
        <div
          className="text-sm px-4 py-2 rounded-lg"
          style={{
            background: msg.includes("失败")
              ? "rgba(248,113,113,0.1)"
              : "rgba(34,197,94,0.1)",
            color: msg.includes("失败") ? "#f87171" : "#4ade80",
          }}
        >
          {msg}
        </div>
      )}

      {/* 账号状态 */}
      <section className="glass p-5">
        <h2
          className="text-sm font-semibold uppercase tracking-wider mb-3"
          style={{ color: "var(--text-secondary)" }}
        >
          账号状态
        </h2>

        {account?.logged_in ? (
          <div className="flex items-center gap-4">
            {account.avatar && (
              <img
                src={toHttpsUrl(account.avatar)}
                alt=""
                className="w-12 h-12 rounded-full"
                referrerPolicy="no-referrer"
              />
            )}
            <div>
              <div className="text-sm font-semibold">{account.nickname}</div>
              <div
                className="text-xs mt-0.5"
                style={{ color: "var(--text-secondary)" }}
              >
                UID {account.uid} · Cookie 有效
              </div>
            </div>
          </div>
        ) : (
          <div className="text-sm" style={{ color: "#f87171" }}>
            {account?.message || "未登录或 Cookie 已过期"}
          </div>
        )}
      </section>

      {/* 更新 Cookie */}
      <section className="glass p-5 space-y-3">
        <h2
          className="text-sm font-semibold uppercase tracking-wider"
          style={{ color: "var(--text-secondary)" }}
        >
          更新 Cookie（延长有效期）
        </h2>
        <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
          获取方式：浏览器登录 https://music.163.com → F12 → Application → Cookies
          → 找到 <code className="px-1 bg-white/10 rounded">MUSIC_U</code>
          ，复制它的值粘贴到下面。
        </p>

        <textarea
          value={cookieInput}
          onChange={(e) => setCookieInput(e.target.value)}
          rows={3}
          placeholder="粘贴 MUSIC_U 的值（很长一串）"
          className="admin-input"
        />

        <div className="flex justify-end">
          <button
            onClick={handleSaveCookie}
            disabled={savingCookie}
            className="px-4 py-2 rounded-lg text-sm disabled:opacity-50"
            style={{ background: "var(--adm-blue)", color: "#fff" }}
          >
            {savingCookie ? "验证中..." : "保存并验证"}
          </button>
        </div>
      </section>

      {/* 前台显示的歌单 */}
      <section className="glass p-5 space-y-3">
        <h2
          className="text-sm font-semibold uppercase tracking-wider"
          style={{ color: "var(--text-secondary)" }}
        >
          前台显示的歌单
        </h2>
        <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
          前台「网易云」标签将只显示这个歌单。留空则显示所有歌单。
        </p>

        {playlists.length === 0 ? (
          <div className="text-sm" style={{ color: "var(--text-secondary)" }}>
            还没有歌单数据，请先更新 Cookie
          </div>
        ) : (
          <>
            <select
              value={configPlaylistId}
              onChange={(e) => setConfigPlaylistId(e.target.value)}
              className="admin-input"
            >
              <option value="" style={{ background: "#171a21" }}>
                不设置（显示全部）
              </option>
              {playlists.map((p) => (
                <option
                  key={p.id}
                  value={p.id}
                  style={{ background: "#171a21" }}
                >
                  {p.name}（{p.track_count} 首）
                </option>
              ))}
            </select>

            {configPlaylistName && (
              <p className="text-xs" style={{ color: "var(--adm-blue)" }}>
                当前设置：{configPlaylistName}
              </p>
            )}

            <div className="flex justify-end">
              <button
                onClick={handleSavePlaylist}
                disabled={savingPlaylist}
                className="px-4 py-2 rounded-lg text-sm disabled:opacity-50"
                style={{ background: "var(--adm-blue)", color: "#fff" }}
              >
                {savingPlaylist ? "保存中..." : "保存"}
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

/* ========== 主页面 ========== */
type TabKey = "local" | "netease";

export default function AdminMusicPage() {
  const [tab, setTab] = useState<TabKey>("local");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <h1 className="text-2xl font-bold">音乐管理</h1>

        <div
          className="tab-switch"
          style={{ width: "280px", maxWidth: "100%" }}
        >
          {[
            { key: "local" as const, label: "本地音乐" },
            { key: "netease" as const, label: "网易云" },
          ].map((t) => {
            const active = tab === t.key;
            return (
              <div
                key={t.key}
                className={`tab ${active ? "active" : ""}`}
                onClick={() => setTab(t.key)}
              >
                <div className="name">{t.label}</div>
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <div style={{ display: tab === "local" ? "block" : "none" }}>
          <LocalSection />
        </div>
        <div style={{ display: tab === "netease" ? "block" : "none" }}>
          <NeteaseSection />
        </div>
      </div>
    </div>
  );
}