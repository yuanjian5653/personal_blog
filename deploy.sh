#!/usr/bin/env bash
# ============================================================
#  个人博客 —— 服务器端一键部署
#
#  在服务器上执行（通常由本地 deploy.ps1 通过 ssh 调用）：
#
#     bash deploy.sh                 完整部署（默认）
#     bash deploy.sh --skip-frontend 只更新后端
#     bash deploy.sh --skip-backend  只更新前端（要求 next.tgz 已上传）
#     bash deploy.sh --dry-run       只打印将执行的命令，不动任何东西
#
#  它做的事：
#     1. 检查工作区干净 → git pull
#     2. 跑**白名单里**的幂等迁移脚本（不给已有表加列，新表靠 create_all）
#     3. 重启后端并等 /api/health 与 /api/tools 通
#     4. 备份旧 .next → 换成新产物 → 校验 BUILD_ID
#     5. 清 nginx 缓存 → nginx -t → reload → 重启前端
#     6. 对外健康检查（站点首页 + 关键接口）
#     7. 任何一步失败 → 自动回滚（后端代码 / 前端产物）并以非 0 退出
#
#  可用环境变量覆盖：
#     PROJECT_DIR  BACKEND_SERVICE  FRONTEND_SERVICE  NGINX_CACHE  SITE_URL  KEEP_BACKUPS  PY
# ============================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="${PROJECT_DIR:-$ROOT}"
BACKEND_SERVICE="${BACKEND_SERVICE:-blog-backend}"
FRONTEND_SERVICE="${FRONTEND_SERVICE:-blog-frontend}"
NGINX_CACHE="${NGINX_CACHE:-/www/server/nginx/proxy_cache_dir}"
SITE_URL="${SITE_URL:-https://yuanjian.website}"
LOCAL_API="http://127.0.0.1:8000"
LOCAL_WEB="http://127.0.0.1:3000"
KEEP_BACKUPS="${KEEP_BACKUPS:-5}"

FRONTEND_DIR="$PROJECT_DIR/blog-frontend"
FRONTEND_TGZ="$FRONTEND_DIR/next.tgz"

# 只跑这些迁移脚本（必须幂等）。**不要**把破坏性脚本加进来，
# 例如 scripts/drop_orphan_posts.py 是删表的。
MIGRATIONS=(
  "migrate_tools_description.py"
  "migrate_tools_color.py"
  "migrate_notification_cursor.py"
  "migrate_life_like_unique.py"
)

SKIP_BACKEND=0
SKIP_FRONTEND=0
DRY=0
for arg in "$@"; do
  case "$arg" in
    --skip-backend)  SKIP_BACKEND=1 ;;
    --skip-frontend) SKIP_FRONTEND=1 ;;
    --dry-run)       DRY=1 ;;
    -h|--help)       sed -n '2,30p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "[错误] 未知参数：$arg"; exit 2 ;;
  esac
done

# ---------- 输出辅助 ----------
step() { printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }
info() { printf '    %s\n' "$1"; }
warn() { printf '\033[1;33m    [注意] %s\033[0m\n' "$1"; }
die()  { printf '\033[1;31m    [失败] %s\033[0m\n' "$1"; exit 1; }

# dry-run 时不真的执行
run() {
  if [ "$DRY" = "1" ]; then
    printf '    [dry] %s\n' "$*"
  else
    eval "$@"
  fi
}

# 等一个 URL 可用（最多 30 秒）
wait_url() {
  local url="$1" name="$2" i
  if [ "$DRY" = "1" ]; then
    info "[dry] 等待 $name 可用：$url"
    return 0
  fi
  for i in $(seq 1 30); do
    if curl -fsS --max-time 5 -o /dev/null "$url" 2>/dev/null; then
      info "$name 可用（${i}s）"
      return 0
    fi
    sleep 1
  done
  return 1
}

# ---------- 回滚 ----------
PREV_COMMIT=""
NEXT_BACKUP=""

# 按阶段回滚：只回退**失败的那一段**。
# 第一参数是原因，第二参数是范围（backend / frontend / both，默认 both）。
# 无差别回滚两端会把已经跑好的那一段也弄坏，排查时更麻烦。
rollback() {
  local reason="$1"
  local scope="${2:-both}"
  printf '\n\033[1;31m    [回滚] %s\033[0m\n' "$reason"

  if [ "$scope" = "frontend" ] || [ "$scope" = "both" ]; then
    if [ -n "$NEXT_BACKUP" ] && [ -f "$NEXT_BACKUP" ]; then
      warn "恢复前端产物：$NEXT_BACKUP"
      systemctl stop "$FRONTEND_SERVICE" || true
      rm -rf "$FRONTEND_DIR/.next"
      tar -xzf "$NEXT_BACKUP" -C "$FRONTEND_DIR" || warn "前端产物恢复失败，请手工处理"
      systemctl start "$FRONTEND_SERVICE" || true
    else
      warn "没有可恢复的前端备份（可能还没替换过产物）"
    fi
  fi

  if [ "$scope" = "backend" ] || [ "$scope" = "both" ]; then
    if [ -n "$PREV_COMMIT" ]; then
      warn "后端代码回退到 $PREV_COMMIT"
      # 必须用 reset --hard 而不是 `checkout <commit> -- blog-backend`：
      # 后者**不会删除**旧提交里不存在的文件（比如新加的 models/tool.py），
      # 回滚后依然会被导入，等于没回滚。
      # 前面已经校验过工作区是干净的，所以 reset --hard 不会误删人的改动。
      git -C "$PROJECT_DIR" reset --hard "$PREV_COMMIT" || warn "后端回退失败，请手工处理"
      # 说明：reset --hard 会把服务器本地的 main 一起指回旧提交，
      # 下次部署的 git pull --ff-only 会正常快进回 origin/main，不会卡住。
      systemctl restart "$BACKEND_SERVICE" || true
    fi
  fi

  printf '\033[1;31m    [回滚] 已尽力恢复，请检查：systemctl status %s %s\033[0m\n' \
    "$BACKEND_SERVICE" "$FRONTEND_SERVICE"
  exit 1
}

# ---------- 0. 版本信息 ----------
step "0. 版本信息"
cd "$PROJECT_DIR"
[ -d .git ] || die "$PROJECT_DIR 不是 git 仓库"
PREV_COMMIT="$(git rev-parse --short HEAD)"
info "当前提交：$PREV_COMMIT"
info "项目目录：$PROJECT_DIR"

# ---------- 1. 拉代码 ----------
step "1. 拉取代码"
if [ -n "$(git status --porcelain)" ]; then
  git status --porcelain | sed 's/^/    /'
  die "工作区有未提交的改动，请先在服务器上处理干净（不要把服务器当编辑器）"
fi
run git pull --ff-only
NEW_COMMIT="$(git rev-parse --short HEAD)"
if [ "$NEW_COMMIT" = "$PREV_COMMIT" ]; then
  info "代码已是最新（$NEW_COMMIT），继续按参数执行"
else
  info "更新：$PREV_COMMIT → $NEW_COMMIT"
fi

# ---------- 2. 数据库迁移 + 后端依赖 ----------
step "2. 数据库迁移与后端依赖"
# 找 python：优先用环境变量 PY 覆盖，其次按常见布局猜
#   服务器上的 venv 名字不一定叫 .venv（也可能叫 venv），猜不到就让人指定：
#     PY=/www/wwwroot/personal_blog/blog-backend/.venv/bin/python bash deploy.sh
PY="${PY:-}"
if [ -z "$PY" ]; then
  for cand in \
    "$PROJECT_DIR/blog-backend/.venv/bin/python" \
    "$PROJECT_DIR/blog-backend/venv/bin/python" \
    "$PROJECT_DIR/.venv/bin/python" \
    "$PROJECT_DIR/venv/bin/python"; do
    # 不能写成 `[ -x "$cand" ] && PY=... && break`：
    # 在 set -e 下这类 && 链的失败语义容易踩坑，用显式 if 最稳
    if [ -x "$cand" ]; then
      PY="$cand"
      break
    fi
  done
fi
[ -n "$PY" ] || PY="$(command -v python3 || true)"
[ -n "$PY" ] || die "找不到 python，无法执行迁移脚本"
info "Python：$PY"

# 迁移脚本要 import 项目自己的模块（sqlmodel / pymysql 等）。
# 系统 python3 通常没有这些依赖 —— 与其等到真正迁移时才报 ImportError，
# 不如现在就明确指出来该怎么修。
if [ "$DRY" = "0" ] && [ "$SKIP_BACKEND" = "0" ]; then
  if ! "$PY" -c "import sqlmodel" >/dev/null 2>&1; then
    warn "这个 python 里没有 sqlmodel：$PY"
    warn "请指定后端自己的解释器，例如："
    warn "  PY=/www/wwwroot/personal_blog/blog-backend/.venv/bin/python bash deploy.sh"
    warn "（可用 systemctl cat $BACKEND_SERVICE | grep ExecStart 查看它实际用的 python）"
    die "python 环境不可用，已中止（没有改动任何文件）"
  fi
fi

RAN=0
for m in "${MIGRATIONS[@]}"; do
  script="$PROJECT_DIR/blog-backend/scripts/$m"
  if [ ! -f "$script" ]; then
    info "跳过 $m（脚本不存在）"
    continue
  fi
  info "执行 $m"
  if [ "$DRY" = "1" ]; then
    info "[dry] $PY $script --yes"
  else
    ( cd "$PROJECT_DIR/blog-backend" && "$PY" "$script" --yes ) || die "迁移脚本 $m 执行失败"
  fi
  RAN=$((RAN + 1))
done
[ "$RAN" -gt 0 ] || info "没有需要执行的迁移"

# 依赖：只有 requirements.txt 在这次拉取里变了才装。
# 为什么必须有这一步：新增 Python 包但没装，重启后后端会直接起不来；
# 那种情况下健康检查会触发回滚 —— 站点没事，但这次部署白跑一趟。
REQ_REL="blog-backend/requirements.txt"
if [ "$SKIP_BACKEND" = "1" ]; then
  info "跳过依赖检查（按参数只更前端）"
elif git -C "$PROJECT_DIR" diff --name-only "$PREV_COMMIT" "$NEW_COMMIT" -- "$REQ_REL" | grep -q .; then
  info "requirements.txt 有变化，安装依赖"
  run "'$PY' -m pip install -r '$PROJECT_DIR/$REQ_REL'"
else
  info "requirements.txt 未变化，跳过 pip install"
fi

# ---------- 3. 后端 ----------
if [ "$SKIP_BACKEND" = "1" ]; then
  step "3. 后端：按参数跳过"
else
  step "3. 重启后端"
  run "systemctl restart $BACKEND_SERVICE"
  if ! wait_url "$LOCAL_API/api/health" "后端 /api/health"; then
    rollback "后端重启后健康检查未通过" backend
  fi
  # /api/tools 能返回就说明表结构也对（缺表/缺列会 500）
  if [ "$DRY" = "0" ]; then
    body="$(curl -fsS --max-time 5 "$LOCAL_API/api/tools" || true)"
    if [ -z "$body" ]; then
      rollback "后端 /api/tools 不可用（可能是表结构问题，看 journalctl -u $BACKEND_SERVICE）" backend
    fi
    info "后端 /api/tools 正常"
  fi
fi

# ---------- 4. 前端产物 ----------
if [ "$SKIP_FRONTEND" = "1" ]; then
  step "4. 前端：按参数跳过"
else
  step "4. 替换前端产物"
  [ -f "$FRONTEND_TGZ" ] || die "找不到 $FRONTEND_TGZ，请先用本地 deploy.ps1 构建并上传"

  if [ -d "$FRONTEND_DIR/.next" ]; then
    NEXT_BACKUP="/root/next-backup-$(date +%Y%m%d-%H%M%S).tgz"
    info "备份旧产物 → $NEXT_BACKUP"
    run "tar -czf '$NEXT_BACKUP' -C '$FRONTEND_DIR' .next"
  fi

  run "systemctl stop $FRONTEND_SERVICE"
  run "rm -rf '$FRONTEND_DIR/.next'"
  run "tar -xzf '$FRONTEND_TGZ' -C '$FRONTEND_DIR'"
  run "rm -f '$FRONTEND_TGZ'"

  if [ "$DRY" = "0" ] && [ ! -f "$FRONTEND_DIR/.next/BUILD_ID" ]; then
    rollback "新产物里没有 BUILD_ID（构建不完整）" frontend
  fi
  [ "$DRY" = "1" ] || info "BUILD_ID：$(cat "$FRONTEND_DIR/.next/BUILD_ID")"

  step "5. 清 nginx 缓存并重载"
  run "rm -rf '$NGINX_CACHE'/*"
  run "nginx -t"
  run "nginx -s reload"

  run "systemctl start $FRONTEND_SERVICE"
  if ! wait_url "$LOCAL_WEB/" "前端 :3000"; then
    rollback "前端启动后健康检查未通过" frontend
  fi
fi

# ---------- 6. 对外健康检查 ----------
step "6. 对外健康检查"
if ! wait_url "$SITE_URL/" "站点首页"; then
  warn "站点首页访问不通（可能是 DNS/证书/安全组问题，而不是本次部署的问题）"
fi
if [ "$DRY" = "0" ]; then
  # 注意：/tools/xxx 是客户端渲染的详情页，任何 slug 都会返回 200
  # （404 是页面内提示），所以不适合当健康检查项
  for path in /api/tools /tools /music; do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "$SITE_URL$path" || echo 000)"
    info "$path -> HTTP $code"
  done
fi

# ---------- 7. 清理旧备份 ----------
step "7. 清理旧前端备份（保留最近 $KEEP_BACKUPS 个）"
if [ "$DRY" = "0" ]; then
  # 注意：不能直接 `ls ... | tail | while`。在 set -o pipefail 下，
  # 首次部署时还没有任何备份，ls 返回非 0 会让整条管道失败 → 脚本中止。
  if compgen -G "/root/next-backup-*.tgz" > /dev/null; then
    ls -1t /root/next-backup-*.tgz \
      | tail -n "+$((KEEP_BACKUPS + 1))" \
      | while read -r old; do
          info "删除 $old"
          rm -f "$old"
        done
  else
    info "还没有备份需要清理"
  fi
else
  info "[dry] 保留最近 $KEEP_BACKUPS 个 /root/next-backup-*.tgz"
fi

step "完成"
info "后端服务：$(systemctl is-active "$BACKEND_SERVICE" 2>/dev/null || echo unknown)"
info "前端服务：$(systemctl is-active "$FRONTEND_SERVICE" 2>/dev/null || echo unknown)"
info "当前提交：$(git rev-parse --short HEAD)"
info "如需回滚前端：tar -xzf /root/next-backup-<时间戳>.tgz -C $FRONTEND_DIR"
