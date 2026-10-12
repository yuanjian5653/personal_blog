/**
 * LRC 歌词解析
 *
 * 支持一行多个时间标签（合唱段落），例如：
 *   [00:12.00][01:20.50]同一句歌词
 */

export interface LyricLine {
  /** 起始时间（秒） */
  time: number;
  text: string;
}

/**
 * 匹配 [mm:ss]、[mm:ss.x]、[mm:ss.xx]、[mm:ss.xxx]
 *
 * 小数位允许 1~3 位：LRC 里虽然多为 2 位（百分秒），但写作
 * [00:01.5] 的文件也存在，之前这里写死 {2,3} 会把整行丢掉。
 */
const TIME_TAG = /\[(\d{2}):(\d{2})(?:\.(\d{1,3}))?\]/g;

/**
 * 把 LRC 文本解析成按时间升序排列的歌词行。
 * 没有时间标签的行（如 [ti:歌名]）会被忽略。
 */
export function parseLrc(lrc: string): LyricLine[] {
  const lines: LyricLine[] = [];

  for (const line of lrc.split("\n")) {
    const matches = [...line.matchAll(TIME_TAG)];
    if (matches.length === 0) continue;

    const text = line.replace(TIME_TAG, "").trim();
    if (!text) continue;

    for (const m of matches) {
      const minutes = parseInt(m[1], 10);
      const seconds = parseInt(m[2], 10);
      // [00:12.5] 补齐成 [00:12.500]
      const ms = m[3] ? parseInt(m[3].padEnd(3, "0"), 10) : 0;
      lines.push({ time: minutes * 60 + seconds + ms / 1000, text });
    }
  }

  return lines.sort((a, b) => a.time - b.time);
}

/** 根据当前播放时间找出正在唱的那一行，找不到返回 -1 */
export function findActiveLyricIndex(
  lyrics: LyricLine[],
  currentTime: number
): number {
  return lyrics.findIndex(
    (line, i) =>
      currentTime >= line.time &&
      (i === lyrics.length - 1 || currentTime < lyrics[i + 1].time)
  );
}
