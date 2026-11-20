import { copyFile, mkdir, readdir, rm } from 'node:fs/promises'

// TypeScript 编译业务客户端，构建步骤同时带上CLI 请求输入校验器和声明，并移除旧的输出产物。
const source = new URL('../src/generated/', import.meta.url)
const output = new URL('../dist/generated/', import.meta.url)
await mkdir(output, { recursive: true })
for (const name of await readdir(output)) {
  if (/^(?:response-.*|error|health|readiness)\.(?:mjs|d\.mts)$/.test(name)) {
    await rm(new URL(name, output))
  }
}
for (const name of await readdir(source)) {
  if (/^input-.*\.(?:mjs|d\.mts)$/.test(name)) {
    await copyFile(new URL(name, source), new URL(name, output))
  }
}
