"""
全局常量：允许上传的文件扩展名。

之前这些集合分散在 router / service 里各写了一份，而且内容不一致
（例如 upload.py 收 .bmp，site_config.py 不收；music.py 的
AUDIO_EXTENSIONS 收 .flac/.wav/.ogg/.aac，metadata.py 却只能解析
mp3/m4a 的标签）。现在统一到一处，改一次全局生效。
"""

# ---- 图片：所有"上传图片"的入口共用 ----
IMAGE_EXTENSIONS: frozenset[str] = frozenset(
    {".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif", ".bmp"}
)

# ---- 音频 ----
# metadata.py 目前只实现了 mp3（ID3）和 m4a（MP4）两种标签体系。
# 上传/扫描都只接受这两种，避免 .flac 之类文件入库后没有标题和时长。
SUPPORTED_AUDIO_EXTENSIONS: frozenset[str] = frozenset({".mp3", ".m4a"})

# 兼容旧命名，指向同一份集合
AUDIO_EXTENSIONS: frozenset[str] = SUPPORTED_AUDIO_EXTENSIONS

# ---- 文档：文章导入（Word / Markdown）----
# Word 走 markitdown 转换；Markdown 本身就是目标格式，直接读文本即可。
WORD_EXTENSIONS: frozenset[str] = frozenset({".docx"})
MARKDOWN_EXTENSIONS: frozenset[str] = frozenset({".md", ".markdown"})

# 文章导入允许的扩展名（两者合集）
DOCUMENT_EXTENSIONS: frozenset[str] = WORD_EXTENSIONS | MARKDOWN_EXTENSIONS
