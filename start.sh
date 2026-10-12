#!/usr/bin/env bash
# ============================================================
#  个人博客 —— 一键启动（Linux / macOS / Git Bash）
#
#  Windows 用户请用 start.bat
#  首次使用请先执行初始化：.venv/bin/python blog-backend/scripts/init_db.py
# ============================================================
set -euo pipefail

# 用脚本自身所在目录作为项目根，避免写死绝对路径
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

# Windows(Git Bash) 与类 Unix 的 venv 路径不同，两个都探测
if [ -x "$ROOT/.venv/bin/python" ]; then
    PY="$ROOT/.venv/bin/python"
elif [ -x "$ROOT/.venv/Scripts/python.exe" ]; then
    PY="$ROOT/.venv/Scripts/python.exe"
else
    echo "[错误] 找不到 Python 虚拟环境：$ROOT/.venv"
    echo
    echo "        请先执行："
    echo "            python -m venv .venv"
    echo "            .venv/bin/python -m pip install -r blog-backend/requirements.txt"
    exit 1
fi

if [ ! -f "$ROOT/blog-backend/.env" ]; then
    echo "[错误] 找不到 blog-backend/.env"
    echo
    echo "        请先初始化数据库与配置："
    echo "            $PY blog-backend/scripts/init_db.py"
    exit 1
fi

if [ ! -d "$ROOT/blog-frontend/node_modules" ]; then
    echo "[提示] 前端依赖尚未安装，正在执行 pnpm install ..."
    (cd "$ROOT/blog-frontend" && pnpm install)
fi

# 退出时一并停掉两个子进程
cleanup() {
    echo
    echo "正在停止服务..."
    [ -n "${BACK_PID:-}" ] && kill "$BACK_PID" 2>/dev/null || true
    [ -n "${FRONT_PID:-}" ] && kill "$FRONT_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "[1/2] 启动 FastAPI 后端 (端口 8000)..."
(cd "$ROOT/blog-backend" && "$PY" -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000) &
BACK_PID=$!

sleep 3

echo "[2/2] 启动 Next.js 前端 (端口 3000)..."
(cd "$ROOT/blog-frontend" && pnpm dev) &
FRONT_PID=$!

echo
echo "================================"
echo "  启动完成"
echo "================================"
echo
echo "后端接口文档：http://localhost:8000/docs"
echo "前台首页：    http://localhost:3000"
echo "后台登录：    http://localhost:3000/admin/login"
echo
echo "按 Ctrl+C 停止全部服务"
echo

wait
