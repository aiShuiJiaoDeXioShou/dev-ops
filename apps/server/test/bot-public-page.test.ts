import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fetchBotPublicPage } from '../src/modules/bots/runtime/public-page.ts'

test('Bot 公开网页读取在连接前拒绝本地、私网和特殊端口', async () => {
  const signal = new AbortController().signal
  for (const address of [
    'http://127.0.0.1/',
    'http://[::1]/',
    'http://169.254.169.254/',
    'http://[::ffff:10.0.0.1]/',
  ]) {
    await assert.rejects(fetchBotPublicPage(address, signal), /不属于公网/u)
  }
  await assert.rejects(fetchBotPublicPage('http://example.test:8080/', signal), /只允许/u)
})
