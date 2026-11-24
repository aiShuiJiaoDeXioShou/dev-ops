import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolveToken } from '../src/lib/token.ts'

test('运行令牌可从环境或标准输入读取，拒绝损坏值与持久化配置', async () => {
  const token = `devops-run-${'a'.repeat(43)}`
  const read = async () => token
  assert.equal(await resolveToken({}, { DEV_OPS_TOKEN: token }, {}, read, 'http://localhost'), token)
  assert.equal(await resolveToken({ tokenStdin: true }, {}, {}, read, 'http://localhost'), token)
  await assert.rejects(resolveToken({}, { DEV_OPS_TOKEN: 'devops-run-invalid' }, {}, read, 'http://localhost'))
  await assert.rejects(resolveToken({}, {}, { token }, read, 'http://localhost'))
})
