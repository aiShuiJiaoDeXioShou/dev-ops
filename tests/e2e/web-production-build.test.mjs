import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { test } from 'node:test'

const assets = new URL('../../apps/web/dist/assets/', import.meta.url)

test('生产 Web 脚本没有打包生成的 Ajv 校验器', async () => {
  const scripts = (await readdir(assets)).filter((file) => file.endsWith('.js'))
  assert.ok(scripts.length > 0, '请先构建 Web 生产产物')

  // Ajv 生成的错误对象包含这些字段，即使压缩改名或调整分块也能识别。
  const generatedValidator = /\binstancePath\s*:[^,}]+,\s*schemaPath\s*:\s*['"`]#\/[^'"`]+['"`],\s*keyword\s*:/
  for (const script of scripts) {
    const source = await readFile(new URL(script, assets), 'utf8')
    assert.equal(generatedValidator.test(source), false, `${script} 包含生成的 Ajv 校验器`)
  }
})
