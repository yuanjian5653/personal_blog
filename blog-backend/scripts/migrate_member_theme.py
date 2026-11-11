"""
创建 member_themes 表（成员自定义主题）。

幂等：表已存在就跳过。

用法：
    python scripts/migrate_member_theme.py --dry-run
    python scripts/migrate_member_theme.py --yes
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import inspect, text  # noqa: E402

from app.database import engine  # noqa: E402

DDL = """
CREATE TABLE IF NOT EXISTS member_themes (
    id INT NOT NULL AUTO_INCREMENT,
    admin_id INT NOT NULL,
    name VARCHAR(50) NOT NULL DEFAULT '我的主题',
    theme_accent VARCHAR(20) NOT NULL DEFAULT '#7c5cff',
    bg_type VARCHAR(20) NOT NULL DEFAULT 'color',
    bg_color VARCHAR(20) NOT NULL DEFAULT '#0f1115',
    bg_image VARCHAR(500) NOT NULL DEFAULT '',
    bg_blur INT NOT NULL DEFAULT 0,
    bg_overlay FLOAT NOT NULL DEFAULT 0,
    card_style VARCHAR(20) NOT NULL DEFAULT 'glass',
    card_text VARCHAR(2000) NOT NULL DEFAULT '',
    card_wave_color1 VARCHAR(20) NOT NULL DEFAULT '#7c5cff',
    card_wave_color2 VARCHAR(20) NOT NULL DEFAULT '#4cc9f0',
    home_album_id INT NULL,
    is_published TINYINT(1) NOT NULL DEFAULT 0,
    updated_at DATETIME NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_member_themes_admin (admin_id),
    KEY ix_member_themes_published (is_published),
    CONSTRAINT fk_member_themes_admin FOREIGN KEY (admin_id) REFERENCES admin (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
"""


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--yes", action="store_true")
    args = parser.parse_args()

    insp = inspect(engine)
    if "member_themes" in insp.get_table_names():
        print("  member_themes 已存在，无需迁移")
        return 0

    print("  将执行: CREATE TABLE member_themes (...)")
    if args.dry_run:
        print("  （dry-run，未执行）")
        return 0
    if not args.yes:
        print("  需要 --yes 才会真的执行")
        return 1

    with engine.begin() as conn:
        conn.execute(text(DDL))
    print("  完成")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
