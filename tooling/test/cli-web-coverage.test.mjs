import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

async function sourceFiles(directory) {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory() && entry.name !== 'prototype') {
      files.push(...(await sourceFiles(path)))
    } else if (entry.isFile() && /\.tsx?$/.test(entry.name) && !/\.(?:test|d)\.tsx?$/.test(entry.name)) {
      files.push(path)
    }
  }
  return files
}

async function clientOperations(workspace, isClient) {
  const operations = new Set()
  for (const path of await sourceFiles(fileURLToPath(new URL(workspace, import.meta.url)))) {
    const source = ts.createSourceFile(path, await readFile(path, 'utf8'), ts.ScriptTarget.Latest, false)
    function visit(node) {
      if (ts.isPropertyAccessExpression(node) && isClient(node.expression)) operations.add(node.name.text)
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  return operations
}

test('Web 使用的共享客户端操作有 CLI 入口或已登记的浏览器例外', async () => {
  const [web, cli, coverage] = await Promise.all([
    clientOperations('../../apps/web/src/', (node) => ts.isIdentifier(node) && node.text === 'apiClient'),
    clientOperations('../../apps/cli/src/', (node) =>
      ts.isIdentifier(node)
        ? node.text === 'client'
        : ts.isPropertyAccessExpression(node) && node.name.text === 'client',
    ),
    readFile(new URL('../../apps/cli/WEB-COVERAGE.md', import.meta.url), 'utf8'),
  ])
  const exceptions = [...coverage.matchAll(/`apiClient\.(\w+)`/g)].map((match) => match[1])
  assert.deepEqual([...web].filter((operation) => !cli.has(operation)).sort(), exceptions.sort())
})
