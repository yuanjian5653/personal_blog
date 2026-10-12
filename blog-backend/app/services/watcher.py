"""
文件监控服务
用 watchdog 监听 media/music/ 目录，实时同步数据库。

事件映射：
- 新增文件 → 延迟入库
- 删除文件 → 从数据库移除
- 改名/移动 → 视为删除旧 + 新增新
"""
import logging
from pathlib import Path

from watchdog.events import FileSystemEventHandler
from watchdog.observers import Observer

from app.config import settings
from app.services.scanner import (
    remove_single_file,
    schedule_index,
)

logger = logging.getLogger(__name__)


class MusicEventHandler(FileSystemEventHandler):
    """
    watchdog 事件处理器。
    每个方法在文件系统发生对应变化时被调用。
    注意：这些方法运行在 watchdog 的独立线程里。
    """

    def on_created(self, event):
        """文件被创建（复制进来、新建）"""
        if event.is_directory:
            return
        file_path = Path(event.src_path)
        logger.info(f"[监控] 新增文件：{file_path.name}")
        schedule_index(file_path)

    def on_deleted(self, event):
        """文件被删除"""
        if event.is_directory:
            return
        file_path = Path(event.src_path)
        logger.info(f"[监控] 删除文件：{file_path.name}")
        remove_single_file(file_path)

    def on_moved(self, event):
        """
        文件被移动或改名。
        watchdog 会给出 src_path（旧）和 dest_path（新）。
        处理方式：删旧记录 + 延迟处理新文件。
        """
        if event.is_directory:
            return
        old_path = Path(event.src_path)
        new_path = Path(event.dest_path)
        logger.info(f"[监控] 移动/改名：{old_path.name} → {new_path.name}")
        remove_single_file(old_path)
        schedule_index(new_path)

    def on_modified(self, event):
        """
        文件被修改（拷贝过程中会频繁触发）。
        我们不做任何事，因为 created 事件已经安排了延迟处理。
        """
        pass


def start_watcher() -> Observer:
    """
    启动文件监控，返回 Observer 对象（用于关闭时停止）。

    流程:
    1. 创建 Observer
    2. 把 MusicEventHandler 绑定到音乐目录（recursive=True 支持子目录）
    3. 启动
    """
    observer = Observer()
    handler = MusicEventHandler()
    observer.schedule(handler, str(settings.MUSIC_DIR), recursive=True)
    observer.start()
    logger.info(f"[监控] 已启动，监听目录：{settings.MUSIC_DIR}")
    return observer