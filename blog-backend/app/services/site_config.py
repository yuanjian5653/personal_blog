"""
站点配置服务
用 key-value 形式存储所有可配置项。
读取时合并默认值，保证新增配置项时前端不会拿到 None。
"""
from sqlmodel import Session, select

from app.models import SiteConfig

# 默认配置：新增配置项只需在这里加一行
DEFAULT_CONFIG: dict[str, str] = {
    # ---- 站点信息 ----
    # 必须和前端 app/layout.tsx 的静态 metadata.title、
    # 以及 Navbar 的 Logo 文字保持一致，否则首屏标题会闪（见 layout.tsx 注释）。
    "site_title": "远见YuanJian",
    "site_subtitle": "个人博客 · 音乐 · 文章 · 图片",
    # ---- 作者信息 ----
    "author_name": "博主",
    "author_avatar": "",          # 头像 URL 或 /api/... 路径
    "author_bio": "这里记录我的日记、音乐、图片，以及一些零散的思绪。",
    # ---- 主题 ----
    "theme_accent": "#7c5cff",    # 主题强调色
    # ---- 全局卡片样式 ----
    # glass: 原版毛玻璃  white: 白色毛玻璃  black: 黑色毛玻璃
    "card_style": "glass",
    # ---- 背景 ----
    "bg_type": "color",           # "color" | "image"
    "bg_color": "#0f1115",        # 纯色背景色
    "bg_image": "",               # 背景图 URL
    "bg_blur": "0",               # 背景图模糊 px
    "bg_overlay": "0.5",          # 背景图遮罩不透明度 0~1
    # ---- 首页卡片 ----
    "card_text": "好，支持，威武，有希望了！ ( ) #(滑稽)",

    # ---- 个人卡片 ----
    # 注：作者卡片的文章/说说/照片数量已改为实时统计
    # （见 routers/site_config.py 的 GET /api/site-config/stats），
    # 不再需要手动填写，因此原来的 author_stats_* 配置项已移除。
    # 老数据库里残留的同名记录不会被读取，也不会报错。

    # ---- 社交链接（留空则不显示对应图标）----
    "social_github": "https://github.com",
    "social_email": "mailto:hello@example.com",
    "social_telegram": "https://t.me",
    "social_discord": "https://discord.com",

    # ---- 网站信息 ----
    "icp_number": "",
    "public_security_number": "",
    # ---- 站点运行时间（用于计算"稳定运行 X 天"）----
    # 格式：YYYY-MM-DD 或 ISO 时间。留空则不显示运行时长
    "site_started_at": "",

    # ---- 首页图片卡片 ----
    "home_album_id": "",  # 首页图片卡片显示哪个图片组的 ID，空表示用第一个


    # 波频条两种颜色（从左到右渐变）
    "card_wave_color1": "#4f5cd6",
    "card_wave_color2": "#ff2d9b",

    # ---- 网易云 ----
    "netease_music_u": "",  # MUSIC_U cookie 值
    "netease_playlist_id": "",  # 前台显示的网易云歌单 ID
    "netease_playlist_name": "",  # 歌单显示名

    # ---- 关于页面 ----
    "about_subtitle": "HELLO WORLD, I'M XINGHUISAMA",
    "about_banner": "",                 # 顶部横幅图 URL（相对 /media/photos/ 或完整 URL）
    "about_content": """## 个人简介

你好，我是 XINGHUISAMA。

专注于计算化学、人工智能与软件工程的交叉应用。

## 研究与计算方向

- **图神经网络**：用于分子性质预测与特征提取。
- **分子对接**：用于评估配体与受体的结合模式与亲和力。
- **分子动力学模拟**：用于探究生物大分子在原子尺度的动态行为与构象变化。

## 软件工程能力

- **后端开发**：使用 Spring Boot 框架构建服务端架构。
- **前端开发**：熟练掌握 Vue.js 与 React 框架。

欢迎各位朋友联系交流～
""",
}


def get_all_configs(db: Session) -> dict[str, str]:
    """
    读取所有配置，与默认值合并。
    数据库里没存过的 key，用默认值补齐。
    """
    rows = db.exec(select(SiteConfig)).all()
    stored = {row.config_key: row.config_value for row in rows}
    # 默认值 + 已存值（已存值覆盖默认）
    return {**DEFAULT_CONFIG, **stored}


def update_configs(db: Session, updates: dict[str, str]) -> dict[str, str]:
    """
    批量更新配置。已存在的 key 更新，不存在的插入。
    返回更新后的完整配置。
    """
    for key, value in updates.items():
        # 跳过不在默认配置里的 key，避免写入垃圾数据
        if key not in DEFAULT_CONFIG:
            continue

        row = db.exec(
            select(SiteConfig).where(SiteConfig.config_key == key)
        ).first()

        if row:
            row.config_value = str(value)
            db.add(row)
        else:
            db.add(SiteConfig(config_key=key, config_value=str(value)))

    db.commit()
    return get_all_configs(db)