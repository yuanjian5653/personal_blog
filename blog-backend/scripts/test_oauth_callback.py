"""
GitHub OAuth 回调的回归测试（mock 掉 GitHub，走真实 FastAPI 路由/CORS/Cookie）。

为什么需要这个测试：
曾经出现过 `_redirect_frontend(True, "登录成功", token)` 的**位置参数错位**
 —— 第三个参数是 return_to，结果 token 被塞进 return_to，
造成两个后果：登录 Cookie 根本没种下（登录后依然不能评论）、
跳转地址变成 token 拼出来的垃圾路径。
本测试把关键不变量固定下来，避免再犯。

用法：python scripts/test_oauth_callback.py
"""
import sys
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlmodel import Session, select

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

from app.config import settings  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Comment, Commenter, CommenterSession, CommentLike  # noqa: E402
import app.routers.comments as comments_mod  # noqa: E402

engine = create_engine(settings.DATABASE_URL, echo=False)

TEST_LOGIN = "__oauth_test"
FAKE_USER = {
    "id": -8899,
    "login": TEST_LOGIN,
    "name": "OAuth Test",
    "avatar_url": "https://avatars.githubusercontent.com/u/1?v=4",
    "html_url": f"https://github.com/{TEST_LOGIN}",
}

FAILS: list[str] = []


def check(label, got, want):
    ok = got == want
    print(f"  [{'OK ' if ok else 'FAIL'}] {label}")
    if not ok:
        FAILS.append(f"{label}: got={got!r} want={want!r}")
        print(f"          got ={got!r}")
        print(f"          want={want!r}")


def check_true(label, cond, extra=""):
    print(f"  [{'OK ' if cond else 'FAIL'}] {label}")
    if not cond:
        FAILS.append(f"{label} {extra}")
        if extra:
            print(f"          {extra}")


# ---- mock 掉真实 GitHub 调用（本机访问不到 github.com）----
async def fake_exchange(client_id, client_secret, code, redirect_uri):
    return "fake-access-token"


async def fake_fetch_user(access_token):
    return FAKE_USER


comments_mod.exchange_code_for_token = fake_exchange
comments_mod.fetch_user = fake_fetch_user

client = TestClient(app, follow_redirects=False)


def cleanup():
    with Session(engine) as db:
        for c in db.exec(select(Commenter).where(Commenter.login == TEST_LOGIN)).all():
            for cm in db.exec(select(Comment).where(Comment.commenter_id == c.id)).all():
                for lk in db.exec(
                    select(CommentLike).where(CommentLike.comment_id == cm.id)
                ).all():
                    db.delete(lk)
                db.delete(cm)
            db.commit()
            for s in db.exec(
                select(CommenterSession).where(CommenterSession.commenter_id == c.id)
            ).all():
                db.delete(s)
            db.commit()
            db.delete(c)
            db.commit()


cleanup()

print("=== 1. 回调要种下登录 Cookie，并跳回发起页 ===")
r = client.get(
    "/api/comments/github/callback",
    params={"code": "fake-code", "state": "STATE123"},
    cookies={"gh_oauth_state": "STATE123", "gh_oauth_return": "%2Fessays"},
)
check("HTTP 302", r.status_code, 302)

loc = r.headers.get("location") or ""
check_true("跳回 /essays（不是首页）", "/essays?comment_login=ok" in loc, f"Location={loc}")
check_true("跳回的是前端地址", loc.startswith(settings.FRONTEND_URL), f"Location={loc}")

set_cookies = r.headers.get_list("set-cookie")
token = None
for sc in set_cookies:
    if sc.startswith("commenter_token="):
        token = sc.split(";")[0].split("=", 1)[1]
        check_true("登录 Cookie 是 HttpOnly", "HttpOnly" in sc, sc)
        check_true("登录 Cookie 有 Max-Age", "Max-Age=" in sc, sc)

check_true("设置了 commenter_token（关键回归点）", token is not None,
           f"set-cookie={set_cookies}")

print("\n=== 2. 用回调种下的 Cookie 应被识别为已登录 ===")
if token:
    r2 = client.get(
        "/api/comments/me",
        cookies={"commenter_token": token},
        headers={"Origin": "http://localhost:3000"},
    )
    check("HTTP 200", r2.status_code, 200)
    body = r2.json()
    check("login 正确", (body or {}).get("login"), TEST_LOGIN)
    check("CORS 允许携带凭据",
          r2.headers.get("access-control-allow-credentials"), "true")

    print("\n=== 3. 已登录后可以发评论 ===")
    with Session(engine) as db:
        from app.models import Essay

        essay = db.exec(select(Essay)).first()
        essay_id = essay.id if essay else None
    if essay_id:
        r3 = client.post(
            f"/api/comments/essay/{essay_id}",
            json={"content": "OAuth 回归测试评论", "parent_id": None},
            cookies={"commenter_token": token},
        )
        check("发评论成功", r3.status_code, 200)
        check("作者是登录用户", (r3.json() or {}).get("author_login"), TEST_LOGIN)
else:
    print("  跳过（上一步没拿到 token）")

print("\n=== 4. 未登录发评论要 401 ===")
with Session(engine) as db:
    from app.models import Essay

    essay = db.exec(select(Essay)).first()
    essay_id = essay.id if essay else None
if essay_id:
    # 注意：必须用一个"干净的" client —— 上面那个 client 的 cookie jar 里
    # 已经存了 commenter_token，复用它测不出未登录的情况
    anon = TestClient(app, follow_redirects=False)
    r4 = anon.post(f"/api/comments/essay/{essay_id}", json={"content": "x"})
    check("未登录 401", r4.status_code, 401)
    r4b = anon.get("/api/comments/me")
    check("未登录 /me 返回 null", r4b.json(), None)

print("\n=== 5. state 不匹配必须被拒（CSRF）===")
r5 = client.get(
    "/api/comments/github/callback",
    params={"code": "fake-code", "state": "WRONG"},
    cookies={"gh_oauth_state": "STATE123"},
)
check("HTTP 302", r5.status_code, 302)
check_true("不带登录 Cookie", not any(
    "commenter_token" in sc for sc in r5.headers.get_list("set-cookie")
))
check_true("提示登录失败", "comment_login=fail" in (r5.headers.get("location") or ""))

print("\n=== 6. GitHub 返回 error ===")
r6 = client.get(
    "/api/comments/github/callback",
    params={"error": "access_denied", "error_description": "用户拒绝"},
)
check_true("提示登录失败", "comment_login=fail" in (r6.headers.get("location") or ""))

print("\n=== 7. 开放重定向防护（不能被带到外站）===")
for bad in ["//evil.com", "http://evil.com", "https://evil.com/x", "/\\evil.com"]:
    rr = client.get(
        "/api/comments/github/callback",
        params={"code": "fake-code", "state": "STATE123"},
        cookies={
            "gh_oauth_state": "STATE123",
            "gh_oauth_return": bad.replace("/", "%2F").replace(":", "%3A"),
        },
    )
    loc = rr.headers.get("location") or ""
    ok = loc.startswith(settings.FRONTEND_URL) and "evil.com" not in loc
    check_true(f"return_to={bad!r} 被拦截", ok, f"Location={loc}")

print("\n=== 8. 清理 ===")
cleanup()
with Session(engine) as db:
    left = db.exec(select(Commenter).where(Commenter.login == TEST_LOGIN)).all()
    left_c = db.exec(select(Comment).where(Comment.author_login == TEST_LOGIN)).all()
check("测试访客已清理", len(left), 0)
check("测试评论已清理", len(left_c), 0)

print()
if FAILS:
    print(f"[失败] {len(FAILS)} 项不通过：")
    for f in FAILS:
        print("  -", f)
    raise SystemExit(1)
print("[通过] OAuth 回调全部断言通过")
