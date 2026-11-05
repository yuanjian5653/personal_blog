<#
.SYNOPSIS
    个人博客 —— 本地一键部署（构建前端 + 上传 + 触发服务器脚本）

.DESCRIPTION
    做三件事：
      1. 检查工作区干净 → git push
      2. 本地 pnpm build（服务器只有 1.6G 内存，跑不动 Next.js 构建）
      3. 打包 .next（排除 cache/dev，通常 ~4 MB）→ scp 上传 → ssh 执行服务器上的 deploy.sh

    产品物替换、清 nginx 缓存、重启、健康检查、失败回滚，全部在
    deploy.sh 里完成（那边的逻辑更接近服务器，也更好维护）。

.PARAMETER SkipBuild
    跳过 pnpm build，直接上传现有的 .next（前端没改动时用，能省两分钟）

.PARAMETER SkipFrontend
    只更新后端（不上传、不替换前端产物）

.PARAMETER SkipPush
    不执行 git push（已经手动推过时用）

.PARAMETER DryRun
    只打印将要执行的步骤，不构建、不上传、不部署

.EXAMPLE
    .\deploy.ps1
    完整部署：推送 + 构建 + 上传 + 服务器端部署

.EXAMPLE
    .\deploy.ps1 -SkipFrontend
    只部署后端（数据库迁移 + 重启后端）

.EXAMPLE
    .\deploy.ps1 -SkipBuild
    复用现有 .next，只上传并部署（CSS/JS 没改时很快）
#>
[CmdletBinding()]
param(
    [string]$Server = "root@8.148.28.245",
    [string]$RemotePath = "/www/wwwroot/personal_blog",
    [switch]$SkipBuild,
    [switch]$SkipFrontend,
    [switch]$SkipPush,
    [switch]$DryRun
)

# 注意：这里**不能**用 "Stop"。
# PowerShell 5.1 下原生命令（git / pnpm / scp / ssh）往 stderr 写东西时
# 会变成 NativeCommandError，而 git push、pnpm build 本来就会往 stderr
# 输出进度 —— 用 Stop 会让脚本在一切正常时也中断。
# 正确做法：保持 Continue，靠每处的 $LASTEXITCODE 判断成败（见 Invoke-Checked）。
$ErrorActionPreference = "Continue"

function Write-Step($text) { Write-Host "`n==> $text" -ForegroundColor Cyan }
function Write-Info($text) { Write-Host "    $text" }
function Write-Warn($text) { Write-Host "    [注意] $text" -ForegroundColor Yellow }
function Fail($text) { Write-Host "    [失败] $text" -ForegroundColor Red; exit 1 }

function Invoke-Checked {
    param([string]$Command, [string]$What)
    if ($DryRun) { Write-Info "[dry] $Command"; return }
    Invoke-Expression $Command
    if ($LASTEXITCODE -ne 0) { Fail "$What 失败（exit $LASTEXITCODE）" }
}

# ---------- 0. 位置与环境检查 ----------
Write-Step "0. 环境检查"
$repoRoot = (Get-Location).Path
if (-not (Test-Path (Join-Path $repoRoot "blog-frontend"))) {
    Fail "请在仓库根目录执行（找不到 blog-frontend）"
}
$frontendDir = Join-Path $repoRoot "blog-frontend"
Write-Info "仓库：$repoRoot"
Write-Info "目标：$Server`:$RemotePath"

if (-not (Test-Path (Join-Path $frontendDir ".env.production.local"))) {
    Write-Warn ".env.production.local 不存在，构建可能把 API 地址打成 localhost:8000"
}

# ---------- 1. 工作区与推送 ----------
Write-Step "1. 检查工作区并推送"
$dirty = git status --porcelain
if ($dirty) {
    $dirty | ForEach-Object { Write-Info $_ }
    Fail "工作区有未提交的改动，请先 commit（部署只认已推送的代码）"
}
$head = (git rev-parse --short HEAD).Trim()
Write-Info "当前提交：$head"

if ($SkipPush) {
    Write-Info "按参数跳过 git push"
} else {
    Invoke-Checked "git push" "git push"
}

# ---------- 2. 构建前端 ----------
if ($SkipFrontend) {
    Write-Step "2. 前端：按参数跳过（只部署后端）"
} elseif ($SkipBuild) {
    Write-Step "2. 前端：按参数跳过构建"
    if (-not (Test-Path (Join-Path $frontendDir ".next\BUILD_ID"))) {
        Fail "没有现成的 .next\BUILD_ID，去掉 -SkipBuild 重新构建"
    }
    Write-Info "复用现有产物：$((Get-Content (Join-Path $frontendDir '.next\BUILD_ID')).Trim())"
} else {
    Write-Step "2. 构建前端（服务器内存不够，必须在这里构建）"
    Push-Location $frontendDir
    try {
        Invoke-Checked "pnpm install --frozen-lockfile" "pnpm install"
        Invoke-Checked "pnpm build" "pnpm build"

        $buildIdFile = Join-Path $frontendDir ".next\BUILD_ID"
        if (-not (Test-Path $buildIdFile)) {
            Fail "构建产物里没有 BUILD_ID —— 构建其实失败了，往上翻 pnpm build 的输出"
        }
        Write-Info "BUILD_ID：$((Get-Content $buildIdFile).Trim())"
    } finally {
        Pop-Location
    }
}

# ---------- 3. 打包 ----------
$tgz = Join-Path $frontendDir "next.tgz"
if (-not $SkipFrontend) {
    Write-Step "3. 打包 .next"
    if (Test-Path $tgz) { Remove-Item $tgz -Force }
    Push-Location $frontendDir
    try {
        # 只打 next start 真正需要的东西。
        # .next/cache（构建缓存，64 MB）与 .next/dev（开发模式产物，124 MB）
        # 都不参与运行：实测 135.7 MB 的包排除这两项后只有 3.6 MB，
        # 1 Mbps 上传从 18 分钟降到半分钟。
        # 安全性：server/ 下 221 个运行时文件没有一个引用 next/cache；
        # 即使判断有误，deploy.sh 的健康检查失败会自动回滚，不会把站点留在坏状态。
        Invoke-Checked "tar -czf next.tgz --exclude='.next/cache' --exclude='.next/dev' .next" "tar 打包"
    } finally {
        Pop-Location
    }
    if (-not $DryRun) {
        $mb = [math]::Round((Get-Item $tgz).Length / 1MB, 1)
        $etaMin = [math]::Round($mb * 1024 / 128 / 60, 1)
        Write-Info "next.tgz：$mb MB（1 Mbps 上传约 $etaMin 分钟）"
        if ($mb -gt 40) {
            Write-Warn "包偏大（$mb MB）。如果远超 10 MB，多半是 .next/cache 或 .next/dev 混进来了，检查打包参数"
        }
    }
}

# ---------- 4. 上传 ----------
if (-not $SkipFrontend) {
    Write-Step "4. 上传到服务器"
    Invoke-Checked "scp `"$tgz`" `"$Server`:$RemotePath/blog-frontend/`"" "scp 上传"
}

# ---------- 5. 触发服务器端部署 ----------
Write-Step "5. 服务器端部署（deploy.sh）"
$flags = @()
if ($SkipFrontend) { $flags += "--skip-frontend" }
if ($DryRun) { $flags += "--dry-run" }
$flagStr = ($flags -join " ")

# 先 git pull 再调 deploy.sh：
#   1) 第一次用这个脚本时，服务器上可能还没有 deploy.sh，需要靠这次 pull 带上去
#   2) deploy.sh 内部还会再 pull 一次（已是 fast-forward，等于空操作）
#   pull 失败（比如服务器工作区脏）时不吞掉错误 —— 交给 deploy.sh 给出更清楚的提示
$remoteCmd = "cd '$RemotePath' && git pull --ff-only >/dev/null 2>&1 || true; bash deploy.sh $flagStr"
if ($SkipFrontend) {
    Write-Info "只更新后端：$remoteCmd"
} else {
    Write-Info "完整部署：$remoteCmd"
}
Invoke-Checked "ssh `"$Server`" `"$remoteCmd`"" "服务器端部署"

# ---------- 6. 汇总 ----------
Write-Step "完成"
Write-Info "提交：$head"
Write-Info "站点：https://yuanjian.website"
if (-not $DryRun) {
    try {
        $code = (curl.exe -s -o NUL -w "%{http_code}" --max-time 10 "https://yuanjian.website/tools" 2>$null)
        Write-Info "/tools -> HTTP $code"
    } catch {
        Write-Warn "无法访问站点，请手动确认"
    }
}
