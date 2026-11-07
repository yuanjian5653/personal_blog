"""统一处理 SQLModel 返回值形态不稳定的问题。

这个版本的 `Session.exec()` 返回值形态**不可靠**：
  · `exec(select(Model)).all()`        有时是模型，有时是 Row（`row[0]` 才是模型）
  · `exec(select(Model.col))`          有时是标量，有时是 Row
  · `exec(select(func.count()))`       有时是 int，有时是 Row

写 `isinstance(x, (tuple, list))` 拦不住 Row（Row 不是 tuple 的子类），
而 `for (v,) in rows` 又会因为拿到标量而报
"cannot unpack non-iterable"。

所以凡是拿单值/模型的地方都走这里的函数，别再每个文件各写一遍。
"""
from __future__ import annotations


def scalar(value, default=None):
    """把 exec(...).one()/.first() 的返回值统一成标量。"""
    if value is None:
        return default
    if isinstance(value, (str, bytes, int, float)):
        return value
    try:
        first = value[0]
    except (TypeError, KeyError, IndexError):
        return value
    return default if first is None else first


def count(value) -> int:
    """统计类查询的返回值 → int。"""
    v = scalar(value, 0)
    try:
        return int(v or 0)
    except (TypeError, ValueError):
        return 0


def model(value):
    """exec(select(Model)).first() 的返回值 → 模型实例（或 None）。"""
    if value is None:
        return None
    try:
        first = value[0]
    except (TypeError, KeyError, IndexError):
        return value
    return first


def models(rows) -> list:
    """exec(select(Model)).all() 的返回值 → 模型列表。"""
    out = []
    for r in rows or []:
        m = model(r)
        if m is not None:
            out.append(m)
    return out


def column_values(rows) -> list:
    """exec(select(Model.col)).all() 的返回值 → 值列表。"""
    out = []
    for r in rows or []:
        v = scalar(r)
        if v is not None:
            out.append(v)
    return out
