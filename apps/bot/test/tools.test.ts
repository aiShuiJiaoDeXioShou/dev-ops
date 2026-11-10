import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import { loadConfig } from '../src/config.ts'
import { bashTool } from '../src/tools/bash.ts'
import { clipText, MAX_FILE_BYTES, MAX_TOOL_OUTPUT_BYTES } from '../src/tools/common.ts'
import { fileTools } from '../src/tools/files.ts'
import { webTools } from '../src/tools/web.ts'

async function invoke(tools: AgentTool<object, null>[], name: string, args: unknown, signal?: AbortSignal) {
  const tool = tools.find((item) => item.name === name)
  assert.ok(tool)
  const result = await tool.execute('test-call', args, signal)
  return {
    ...result,
    text: result.content
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join(''),
  }
}

test('工作目录配置独立解析，Bash 不继承模型密钥和启动脚本变量', () => {
  const config = loadConfig(
    { BOT_WORKSPACE: '../workspace', PATH: '/bin', DEEPSEEK_API_KEY: 'test-secret', BASH_ENV: '/unwanted' },
    '/tmp/bot',
  )
  assert.equal(config.workspacePath, '/tmp/workspace')
  assert.deepEqual(config.bashEnvironment, { PATH: '/bin' })
  assert.throws(() => loadConfig({ DEEPSEEK_WEB_BASE_URL: 'https://user:password@example.com' }), /配置不合法/u)
})

test('文件按行读取、创建父目录、不隐式覆盖，显式覆盖后不留临时文件', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bot-files-'))
  const tools = fileTools(loadConfig({ BOT_WORKSPACE: directory }))
  try {
    const created = await invoke(tools, 'write_file', { path: 'nested/note.txt', content: '第一行\n第二行\n第三行' })
    assert.ok(!created.isError)
    const original = await readFile(join(directory, 'nested/note.txt'), 'utf8')
    const read = await invoke(tools, 'read_file', { path: 'nested/note.txt', offset: 2, limit: 1 })
    assert.match(read.text, /2: 第二行/u)
    assert.match(read.text, /offset=3/u)
    assert.doesNotMatch(read.text, /第一行/u)
    const conflict = await invoke(tools, 'write_file', { path: 'nested/note.txt', content: '不能覆盖' })
    assert.equal(conflict.isError, true)
    assert.equal(await readFile(join(directory, 'nested/note.txt'), 'utf8'), original)
    assert.ok(
      !(await invoke(tools, 'write_file', { path: 'nested/note.txt', content: '已更新', overwrite: true })).isError,
    )
    assert.equal(await readFile(join(directory, 'nested/note.txt'), 'utf8'), '已更新')
    assert.deepEqual(await readdir(join(directory, 'nested')), ['note.txt'])
    assert.equal((await invoke(tools, 'read_file', { path: 'missing' })).isError, true)
    assert.equal((await invoke(tools, 'read_file', { path: 'nested/note.txt', offset: 0 })).isError, true)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('文件大小、文本类型、取消和工具输出预算生效，已知密钥脱敏', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bot-files-limit-'))
  const secret = 'test-secret-that-must-not-leak'
  const tools = fileTools(loadConfig({ BOT_WORKSPACE: directory, DEEPSEEK_API_KEY: secret }))
  try {
    await writeFile(join(directory, 'large'), Buffer.alloc(MAX_FILE_BYTES + 1))
    await writeFile(join(directory, 'binary'), Buffer.from([0xff, 0x00]))
    await writeFile(join(directory, 'secret.txt'), `before ${secret} after`)
    assert.equal((await invoke(tools, 'read_file', { path: 'large' })).isError, true)
    assert.equal((await invoke(tools, 'read_file', { path: 'binary' })).isError, true)
    const redacted = await invoke(tools, 'read_file', { path: 'secret.txt' })
    assert.doesNotMatch(redacted.text, new RegExp(secret, 'u'))
    const oversized = await invoke(tools, 'write_file', { path: 'oversized', content: 'x'.repeat(MAX_FILE_BYTES + 1) })
    assert.equal(oversized.isError, true)
    const controller = new AbortController()
    controller.abort()
    const cancelled = await invoke(tools, 'write_file', { path: 'cancelled', content: '不应写入' }, controller.signal)
    assert.equal(cancelled.isError, true)
    assert.ok(!(await readdir(directory)).includes('cancelled'))
    const clipped = clipText('中'.repeat(MAX_TOOL_OUTPUT_BYTES))
    assert.equal(clipped.truncated, true)
    assert.ok(Buffer.byteLength(clipped.text) <= MAX_TOOL_OUTPUT_BYTES)
    assert.ok(!clipped.text.includes('\ufffd'))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('Bash 支持管道、固定 cwd、合并输出，非零退出和输出截断可见', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bot-bash-'))
  const config = loadConfig({ BOT_WORKSPACE: directory, DEEPSEEK_API_KEY: 'secret', PATH: '/usr/bin:/bin' })
  const tools = [bashTool(config)]
  try {
    const success = await invoke(tools, 'bash', {
      command: 'pwd; printf hello | tr a-z A-Z; printf error >&2; test -z "$DEEPSEEK_API_KEY"',
    })
    assert.ok(!success.isError)
    assert.match(success.text, /HELLO/u)
    assert.match(success.text, /error/u)
    assert.ok(
      success.text.includes(directory.replace(/^\/var\//u, '/private/var/')) || success.text.includes(directory),
    )
    const failed = await invoke(tools, 'bash', { command: 'printf failed >&2; exit 7' })
    assert.equal(failed.isError, true)
    assert.match(failed.text, /退出码：7/u)
    const large = await invoke(tools, 'bash', { command: 'head -c 100000 /dev/zero | tr "\\0" x' })
    assert.ok(!large.isError)
    assert.match(large.text, /截断/u)
    assert.ok(Buffer.byteLength(large.text) <= MAX_TOOL_OUTPUT_BYTES)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('Bash 超时和取消终止子进程组，延迟写入不会在返回后发生', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bot-bash-abort-'))
  const config = { ...loadConfig({ BOT_WORKSPACE: directory }), toolTimeoutMs: 80 }
  const tools = [bashTool(config)]
  try {
    const timedOut = await invoke(tools, 'bash', { command: '(sleep 0.3; printf leaked > timeout-leak) & wait' })
    assert.equal(timedOut.isError, true)
    assert.match(timedOut.text, /超时/u)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 30)
    try {
      const cancelled = await invoke(
        tools,
        'bash',
        { command: '(sleep 0.3; printf leaked > abort-leak) & wait' },
        controller.signal,
      )
      assert.equal(cancelled.isError, true)
      assert.match(cancelled.text, /取消/u)
    } finally {
      clearTimeout(timer)
    }
    await new Promise((resolve) => setTimeout(resolve, 350))
    assert.deepEqual(await readdir(directory), [])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('DeepSeek 联网使用原有凭据和官方协议，搜索结果及 Markdown 可用', async () => {
  const config = loadConfig({ DEEPSEEK_API_KEY: 'test-placeholder' })
  const calls: { url: string; body: unknown }[] = []
  const fetcher: typeof fetch = async (url, options) => {
    assert.equal(new Headers(options?.headers).get('authorization'), 'Bearer test-placeholder')
    assert.equal(options?.redirect, 'error')
    assert.equal(options?.method, 'POST')
    assert.equal(typeof options?.body, 'string')
    calls.push({ url: String(url), body: typeof options?.body === 'string' ? JSON.parse(options.body) : null })
    return Response.json(
      String(url).endsWith('/search')
        ? { results: [{ title: '文档', url: 'https://example.com', snippet: '摘要', summary: '详细摘要', date: null }] }
        : { title: '示例', content: '# 正文\n\n网页内容' },
    )
  }
  const tools = webTools(config, fetcher)
  const search = await invoke(tools, 'web_search', { query: '测试 site:example.com', count: 3 })
  assert.ok(!search.isError)
  assert.match(search.text, /详细摘要/u)
  assert.deepEqual(calls[0], {
    url: 'https://api.deepseek.com/v1/tools/search',
    body: { query: '测试 site:example.com', count: 3, need_content: false },
  })
  const page = await invoke(tools, 'web_fetch', { url: 'https://example.com' })
  assert.ok(!page.isError)
  assert.match(page.text, /# 正文/u)
  assert.deepEqual(calls[1], { url: 'https://api.deepseek.com/v1/tools/fetch', body: { url: 'https://example.com' } })
  assert.equal((await invoke(tools, 'web_fetch', { url: 'file:///etc/passwd' })).isError, true)
  assert.equal((await invoke(tools, 'web_fetch', { url: 'https://user:password@example.com' })).isError, true)
  assert.equal(calls.length, 2)
})

test('联网失败、响应异常和超限均为工具错误，原始错误不泄露且不自动重试', async () => {
  const config = loadConfig({ DEEPSEEK_API_KEY: 'test-placeholder' })
  let count = 0
  const rejected = webTools(config, async () => {
    count += 1
    return Response.json({ error: { message: 'sensitive internal diagnostic' } }, { status: 402 })
  })
  const error = await invoke(rejected, 'web_search', { query: '测试' })
  assert.equal(error.isError, true)
  assert.match(error.text, /余额不足/u)
  assert.doesNotMatch(error.text, /sensitive/u)
  assert.equal(count, 1)
  const invalid = webTools(config, async () => Response.json({ results: 'invalid' }))
  assert.equal((await invoke(invalid, 'web_search', { query: '测试' })).isError, true)
  const tooLarge = webTools(config, async () => new Response('x'.repeat(MAX_FILE_BYTES + 1)))
  assert.equal((await invoke(tooLarge, 'web_fetch', { url: 'https://example.com' })).isError, true)
  const empty = webTools(config, async () => Response.json({ results: [] }))
  assert.ok(!(await invoke(empty, 'web_search', { query: '无结果' })).isError)
})

test('真实 HTTP 传输拒绝重定向，响应体卡住时由工具超时中断', async () => {
  let leakedRequests = 0
  const server = createServer((request, response) => {
    if (request.url === '/search') {
      response.writeHead(302, { location: '/leak' }).end()
      return
    }
    if (request.url === '/leak') {
      leakedRequests += 1
      response.end('{}')
      return
    }
    response.writeHead(200, { 'content-type': 'application/json' })
    response.write('{"content":"')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    assert.ok(address && typeof address === 'object')
    const config = {
      ...loadConfig({
        DEEPSEEK_API_KEY: 'test-placeholder',
        DEEPSEEK_WEB_BASE_URL: `http://127.0.0.1:${address.port}`,
      }),
      toolTimeoutMs: 100,
    }
    const tools = webTools(config)
    assert.equal((await invoke(tools, 'web_search', { query: '不会转发密钥' })).isError, true)
    assert.equal(leakedRequests, 0)
    const timedOut = await invoke(tools, 'web_fetch', { url: 'https://example.com' })
    assert.equal(timedOut.isError, true)
    assert.match(timedOut.text, /超时/u)
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  }
})
