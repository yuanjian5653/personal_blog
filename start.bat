@echo off
chcp 65001 >nul
setlocal
title 个人博客 - 启动器

echo ================================
echo   个人博客 - 一键启动
echo ================================
echo.

REM 用脚本自身所在目录作为项目根，避免写死绝对路径
set "ROOT=%~dp0"

REM ---------- 前置检查：缺什么就明确告诉用户怎么补 ----------
if not exist "%ROOT%.venv\Scripts\python.exe" (
    echo [错误] 找不到 Python 虚拟环境：%ROOT%.venv
    echo.
    echo        请先在项目根目录执行：
    echo            python -m venv .venv
    echo            .venv\Scripts\python.exe -m pip install -r blog-backend\requirements.txt
    echo.
    pause
    exit /b 1
)

if not exist "%ROOT%blog-backend\.env" (
    echo [错误] 找不到 blog-backend\.env
    echo.
    echo        请先初始化数据库与配置：
    echo            .venv\Scripts\python.exe blog-backend\scripts\init_db.py
    echo.
    pause
    exit /b 1
)

if not exist "%ROOT%blog-frontend\node_modules" (
    echo [提示] 前端依赖尚未安装，正在执行 pnpm install ...
    pushd "%ROOT%blog-frontend"
    call pnpm install
    popd
)

echo [1/2] 启动 FastAPI 后端 (端口 8000)...
start "博客后端" cmd /k "cd /d "%ROOT%blog-backend" && "%ROOT%.venv\Scripts\python.exe" -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000"

timeout /t 3 /nobreak >nul

echo [2/2] 启动 Next.js 前端 (端口 3000)...
start "博客前端" cmd /k "cd /d "%ROOT%blog-frontend" && pnpm dev"

echo.
echo ================================
echo   启动完成
echo ================================
echo.
echo 后端接口文档：http://localhost:8000/docs
echo 前台首页：    http://localhost:3000
echo 后台登录：    http://localhost:3000/admin/login
echo.
echo 注意：关闭本窗口不会停止服务，
echo       需要停止请关闭那两个新开的窗口。
echo.
pause
endlocal
