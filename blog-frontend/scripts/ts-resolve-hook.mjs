/**
 * Node ESM 解析钩子：把无扩展名的相对导入解析到 .ts 文件。
 *
 * Next.js/TypeScript 允许 `import { API_BASE } from "./api"`，
 * 但 Node 的原生 ESM 要求写全扩展名。这个钩子只在跑自检脚本时用，
 * 不影响项目本身。
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) {
    const parentPath = fileURLToPath(context.parentURL);
    const base = new URL(specifier, context.parentURL);
    for (const ext of [".ts", ".tsx", ".js"]) {
      const candidate = new URL(base.href + ext);
      if (existsSync(fileURLToPath(candidate))) {
        return nextResolve(candidate.href, context);
      }
    }
    void parentPath;
  }
  return nextResolve(specifier, context);
}
