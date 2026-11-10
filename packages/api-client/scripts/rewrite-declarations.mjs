import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// TypeScript 的 rewriteRelativeImportExtensions 只改写 JS 产物，声明文件中的
// 相对 .ts 说明符仍需在此统一改为 .js，避免下游按 NodeNext 解析时引用源码扩展名。
const dist = fileURLToPath(new URL('../dist/', import.meta.url))
const pattern = /((?:from|import)\s*(?:\(\s*)?)(['"])(\.[^'"]+)\.ts\2/g

/**
 * 递归改写声明文件中的相对 .ts 导入说明符。
 * @param directory 待处理的目录。
 * @returns 全部声明文件处理完成后结束。
 */
async function rewrite(directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, item.name)
    if (item.isDirectory()) {
      await rewrite(path)
      continue
    }
    if (!/\.d\.(?:ts|mts|cts)$/.test(item.name)) continue
    const content = await readFile(path, 'utf8')
    const next = content.replace(pattern, (match, prefix, quote, specifier) => {
      return `${prefix}${quote}${specifier}.js${quote}`
    })
    if (next !== content) await writeFile(path, next)
  }
}

await rewrite(dist)
