"""
安全工具模块
职责：
1. 密码哈希与校验（用 bcrypt）
2. Session Token 生成（用 secrets 生成密码学安全的随机串）
"""
import secrets
import bcrypt


def hash_password(plain_password: str) -> str:
    """
    把明文密码转换成 bcrypt 哈希字符串。

    bcrypt 的特点：
    - 同一个密码每次哈希结果都不同（因为自带随机 salt）
    - 无法反推原文，只能通过 verify 校验
    - 计算故意偏慢，防止暴力破解

    参数:
        plain_password: 用户输入的明文密码

    返回:
        形如 "$2b$12$..." 的哈希字符串，可直接存入数据库
    """
    # 1. 把字符串编码成 bytes（bcrypt 只接受 bytes）
    password_bytes = plain_password.encode("utf-8")
    # 2. gensalt() 生成随机盐，默认 cost=12（计算强度，越大越慢越安全）
    salt = bcrypt.gensalt()
    # 3. 哈希，返回值也是 bytes
    hashed = bcrypt.hashpw(password_bytes, salt)
    # 4. 解码成 str 方便存数据库（MySQL 的 VARCHAR 字段）
    return hashed.decode("utf-8")


def verify_password(plain_password: str, password_hash: str) -> bool:
    """
    校验明文密码是否与数据库里的哈希匹配。

    参数:
        plain_password: 用户本次输入的明文密码
        password_hash: 数据库里存的哈希字符串

    返回:
        True 表示密码正确，False 表示错误
    """
    try:
        return bcrypt.checkpw(
            plain_password.encode("utf-8"),
            password_hash.encode("utf-8"),
        )
    except (ValueError, TypeError):
        # 哈希格式不合法时（比如数据库里是空串），直接返回 False
        # 不要让异常冒泡到接口层，避免 500 错误泄露信息
        return False


def generate_session_token() -> str:
    """
    生成一个密码学安全的随机 Token，用于 Session 标识。

    为什么用 secrets 而不是 random？
    - random 是可预测的伪随机，不适合做安全凭证
    - secrets 基于操作系统提供的加密随机源，不可预测

    返回:
        64 个字符的十六进制字符串（32 字节随机数的 hex 表示）
        例如 "a3f8c1e9b2d4..."
    """
    # token_urlsafe(32) 会生成 URL 安全的 base64 字符串，约 43 字符
    # token_hex(32) 生成 64 字符的十六进制串，这里用 hex 更直观
    return secrets.token_hex(32)