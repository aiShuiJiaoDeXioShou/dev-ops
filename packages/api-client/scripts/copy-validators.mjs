import { copyFile, readdir } from 'node:fs/promises'

// TypeScript 编译业务客户端，构建步骤同时带上由契约生成的 ESM 校验器与类型声明。
const source = new URL('../src/generated/', import.meta.url)
const output = new URL('../dist/generated/', import.meta.url)
for (const name of await readdir(source)) {
  if (name.endsWith('.mjs') || name.endsWith('.d.mts')) {
    await copyFile(new URL(name, source), new URL(name, output))
  }
}
