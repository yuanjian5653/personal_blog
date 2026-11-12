"""
网络相关的小工具。

为什么单独抽出来：
    auth.py（登录限速）和 subscribe.py（订阅频率限制）原来**各自**
    实现了一份 _parse_xff / _client_ip，逻辑一样、写法微差。
    两处都关系到"按 IP 限流"，一旦有一边改错，另一边的限流就形同虚设。
    统一到这里，只维护一份。
"""
from __future__ import annotations

from fastapi import Request


def parse_xff(xff: str | None) -> str | None:
    """从 X-Forwarded-For 里取**真实客户端 IP**（取最后一段）。

    为什么取最后一段而不是第一段：
        本站 nginx 用的是
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        这个变量把 $remote_addr **追加**到客户端传来的值后面。客户端如果
        自己伪造了这个头，结果会是  <攻击者伪造的IP>, <真实IP>
        取第一段等于用了攻击者给的假 IP —— 换着假 IP 就能绕过限速。
        取最后一段才是离我们最近的那一跳（nginx 看到的真实地址）。

    只有一个反代（nginx）时这个规则是安全的；将来若在前面再加一层代理，
    要改成"从右往左跳过已知可信代理"的写法。
    """
    if not xff:
        return None
    parts = [p.strip() for p in xff.split(",") if p.strip()]
    return parts[-1] if parts else None


def client_ip(request: Request) -> str | None:
    """取真实客户端 IP。

    拿不到时返回 None —— 调用方自己决定是"跳过限流"还是用占位符。
    （两个调用点策略不同：登录限速用 "unknown" 兜底，订阅那边
    干脆不按 IP 记；所以这里不替它们做主。）
    """
    real = parse_xff(request.headers.get("x-forwarded-for"))
    if real:
        return real
    if request.client:
        return request.client.host
    return None
