import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // ---------- 项目约定 ----------
  {
    rules: {
      /**
       * 关掉 @next/next/no-img-element（原本 35 条 warning 全来自这一条）。
       *
       * 为什么不用 next/image：
       *   1. 本站图片全部来自后端（/api/music/cover/*、/media/photos|thumbs/*）
       *      或网易云 CDN，显示尺寸在布局里固定，不需要按视口生成多档
       *   2. next/image 会在服务端按需优化图片（sharp），而服务器只有 1.6 GB
       *      内存、1 Mbps 带宽 —— 这是净增的 CPU/内存开销，换不来带宽收益
       *   3. 带宽问题已用别的方式解决：后端会生成 thumbs/ 缩略图，
       *      并且做过一轮图片压缩（大图从 3 MB 降到 300 KB 级别）
       *   4. 外链图片还要在 next.config 里维护 remotePatterns，成本大于收益
       *
       * 以后若要迁移到 <Image />，把这里改回 "warn" 即可逐步推进。
       */
      "@next/next/no-img-element": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
