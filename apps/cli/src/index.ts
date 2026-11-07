#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { runCli } from './cli.js'

try {
  const metadata: unknown = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  if (typeof metadata !== 'object' || metadata === null || !('version' in metadata)
    || typeof metadata.version !== 'string') {
    throw new Error('无法读取 CLI 版本信息')
  }

  process.exitCode = await runCli(process.argv.slice(2), {
    version: metadata.version,
    env: process.env,
    stdout: (message) => { process.stdout.write(message) },
    stderr: (message) => { process.stderr.write(message) },
  })
} catch {
  process.stderr.write('错误：CLI 启动失败，请检查安装是否完整。\n')
  process.exitCode = 1
}
