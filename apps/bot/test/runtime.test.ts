import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  createAssistantMessageEventStream,
  getCurrentSystemPrompt,
  getCurrentTools,
  type AssistantMessage,
} from '@earendil-works/pi-ai'
import type { StreamFn } from '@earendil-works/pi-agent-core'
import { chat } from '../src/bot.ts'
import { loadConfig } from '../src/config.ts'
import { parseHistory } from '../src/history.ts'
import { compatibleHistory, runtimeContextKey, tagRuntimeMessages } from '../src/runtime-context.ts'
import { createRuntime } from '../src/runtime.ts'
import { BotStore } from '../src/storage/store.ts'

function message(
  content: AssistantMessage['content'],
  stopReason: AssistantMessage['stopReason'] = 'stop',
): AssistantMessage {
  return {
    role: 'assistant',
    api: 'openai-completions',
    provider: 'deepseek',
    model: 'deepseek-flash',
    content,
    stopReason,
    timestamp: Date.now(),
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  }
}

function scripted(responses: AssistantMessage[]): StreamFn {
  return () => {
    const stream = createAssistantMessageEventStream()
    const response = responses.shift()
    assert.ok(response)
    if (response.stopReason === 'error' || response.stopReason === 'aborted') {
      stream.push({ type: 'error', reason: response.stopReason, error: response })
    } else {
      assert.ok(response.stopReason === 'stop' || response.stopReason === 'toolUse' || response.stopReason === 'length')
      stream.push({ type: 'done', reason: response.stopReason, message: response })
    }
    return stream
  }
}

const config = loadConfig({ DEEPSEEK_API_KEY: 'test-placeholder' })

test('真实 pi 循环调用记忆工具，成功后保存完整工具配对，并支持重新开启会话', async () => {
  const store = new BotStore(':memory:')
  try {
    const runtime = createRuntime(
      config,
      scripted([
        message(
          [
            {
              type: 'toolCall',
              id: 'remember-1',
              name: 'remember_memory',
              arguments: { content: '偏好中文', essential: true },
            },
          ],
          'toolUse',
        ),
        message([{ type: 'text', text: '已记住' }]),
      ]),
    )
    assert.equal(await chat(store, runtime, 'main', '请记住我偏好中文'), '已记住')
    assert.equal(store.memories()[0]?.content, '偏好中文')
    assert.equal(store.snapshot('other').memories[0]?.content, '偏好中文')
    // 记忆写入使旧上下文失效，后续从权威记忆重新构造。
    assert.deepEqual(store.snapshot('main').messages, [])
    const next = createRuntime(
      config,
      scripted([
        message(
          [{ type: 'toolCall', id: 'search-1', name: 'search_memories', arguments: { query: '中文' } }],
          'toolUse',
        ),
        message([{ type: 'text', text: '继续' }]),
      ]),
    )
    await chat(store, next, 'main', '继续')
    assert.deepEqual(
      store.snapshot('main').messages.map((item) => item.role),
      ['user', 'assistant', 'toolResult', 'assistant'],
    )
    const restored = createRuntime(config, scripted([message([{ type: 'text', text: '恢复成功' }])]))
    await chat(store, restored, 'main', '接着聊')
    assert.equal(store.snapshot('main').messages.length, 6)
  } finally {
    store.close()
  }
})

test('pi 返回错误而不抛异常时也回滚暂存记忆，不保存半轮历史', async () => {
  const store = new BotStore(':memory:')
  try {
    const runtime = createRuntime(
      config,
      scripted([
        message(
          [
            {
              type: 'toolCall',
              id: 'remember-1',
              name: 'remember_memory',
              arguments: { content: '不能提交', essential: false },
            },
          ],
          'toolUse',
        ),
        message([], 'error'),
      ]),
    )
    await assert.rejects(chat(store, runtime, 'main', '记住'), /未保存/u)
    assert.deepEqual(store.memories(), [])
    assert.deepEqual(store.snapshot('main').messages, [])
  } finally {
    store.close()
  }
})

test('用户取消和输出截断均不作为成功提交', async () => {
  const store = new BotStore(':memory:')
  try {
    const controller = new AbortController()
    controller.abort()
    await assert.rejects(chat(store, createRuntime(config, scripted([])), 'main', '取消', controller.signal), /取消/u)
    await assert.rejects(
      chat(
        store,
        createRuntime(config, scripted([message([{ type: 'text', text: '未完成' }], 'length')])),
        'main',
        '截断',
      ),
      /未保存/u,
    )
    assert.deepEqual(store.snapshot('main').messages, [])
  } finally {
    store.close()
  }
})

test('超过八轮工具循环或到达请求超时，均中止运行并回滚', async () => {
  const store = new BotStore(':memory:')
  try {
    const endless = scripted(
      Array.from({ length: 8 }, (_, index) =>
        message(
          [{ type: 'toolCall', id: `loop-${index}`, name: 'search_memories', arguments: { query: '' } }],
          'toolUse',
        ),
      ),
    )
    await assert.rejects(chat(store, createRuntime(config, endless), 'main', '循环'), /未保存/u)
    const slow: StreamFn = (_model, _context, options) => {
      const stream = createAssistantMessageEventStream()
      options?.signal?.addEventListener(
        'abort',
        () => {
          stream.push({ type: 'error', reason: 'aborted', error: message([], 'aborted') })
        },
        { once: true },
      )
      return stream
    }
    await assert.rejects(chat(store, createRuntime({ ...config, timeoutMs: 20 }, slow), 'main', '超时'), /超时/u)
    assert.deepEqual(store.snapshot('main').messages, [])
  } finally {
    store.close()
  }
})

test('pi 顺序完成写入、读取和 Bash 调用，完整工具结果可恢复', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bot-runtime-tools-'))
  const store = new BotStore(':memory:')
  try {
    const runtime = createRuntime(
      { ...config, workspacePath: directory },
      scripted([
        message(
          [
            {
              type: 'toolCall',
              id: 'write-1',
              name: 'write_file',
              arguments: { path: 'notes/result.txt', content: '工具已接入' },
            },
            { type: 'toolCall', id: 'read-1', name: 'read_file', arguments: { path: 'notes/result.txt' } },
            {
              type: 'toolCall',
              id: 'bash-1',
              name: 'bash',
              arguments: { command: "printf '\\nBash追加' >> notes/result.txt" },
            },
          ],
          'toolUse',
        ),
        message([{ type: 'text', text: '完成' }]),
      ]),
    )
    assert.equal(await chat(store, runtime, 'tools', '按顺序操作文件'), '完成')
    assert.equal(await readFile(join(directory, 'notes/result.txt'), 'utf8'), '工具已接入\nBash追加')
    const results = store.snapshot('tools').messages.filter((item) => item.role === 'toolResult')
    assert.equal(results.length, 3)
    assert.ok(results.every((item) => !item.isError))
    const read = results.find((item) => item.toolName === 'read_file')
    assert.ok(read)
    assert.match(JSON.stringify(read.content), /工具已接入/u)
    assert.doesNotMatch(JSON.stringify(read.content), /Bash追加/u)
  } finally {
    store.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('写入后模型失败只回滚对话和记忆，不声称文件操作已经回滚', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bot-runtime-side-effect-'))
  const store = new BotStore(':memory:')
  try {
    const runtime = createRuntime(
      { ...config, workspacePath: directory },
      scripted([
        message(
          [
            {
              type: 'toolCall',
              id: 'write-1',
              name: 'write_file',
              arguments: { path: 'written.txt', content: '已生效' },
            },
          ],
          'toolUse',
        ),
        message([], 'error'),
      ]),
    )
    await assert.rejects(chat(store, runtime, 'tools', '写文件'), /工具操作不会回滚/u)
    assert.equal(await readFile(join(directory, 'written.txt'), 'utf8'), '已生效')
    assert.deepEqual(store.snapshot('tools').messages, [])
  } finally {
    store.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('恢复无指纹的旧会话时隔离过时上下文，保留历史记录和长期记忆', async () => {
  const store = new BotStore(':memory:')
  try {
    store.editMemories((workspace) => workspace.remember('偏好中文', true, null))
    const legacy = store.snapshot('upgraded')
    store.commit(
      legacy,
      [
        { role: 'user', content: '能联网吗？', timestamp: 1 },
        message([{ type: 'text', text: '我没有 web 工具，只有 search_memories、remember_memory 和 forget_memory。' }]),
      ],
      legacy.memories,
    )
    let requests = 0
    const response = scripted([message([{ type: 'text', text: '使用本轮的工具清单' }])])
    const runtime = createRuntime(config, (model, context, options) => {
      requests += 1
      const names = getCurrentTools(context.messages).map((tool) => tool.name)
      assert.deepEqual(names, [
        'search_memories',
        'remember_memory',
        'forget_memory',
        'web_search',
        'web_fetch',
        'read_file',
        'write_file',
        'bash',
      ])
      const prompt = getCurrentSystemPrompt(context.messages)
      const inventory = prompt.split('\n').find((line) => line.startsWith('本轮实际注册的工具：'))
      assert.ok(inventory)
      for (const name of names) assert.ok(inventory.includes(name))
      assert.match(prompt, /历史助手.*旧版本/u)
      assert.ok(!context.messages.some((item) => item.role === 'assistant'))
      assert.match(prompt, /偏好中文/u)
      return response(model, context, options)
    })
    await chat(store, runtime, 'upgraded', '请你使用 web 工具帮我搜索，我记得你有这个工具')
    assert.equal(requests, 1)
    assert.equal(store.snapshot('upgraded').messages.length, 4)
    assert.match(JSON.stringify(store.snapshot('upgraded').messages[1]), /我没有 web 工具/u)
    assert.equal(store.memories()[0]?.content, '偏好中文')
  } finally {
    store.close()
  }
})

test('工具指纹不受注册顺序影响，契约变化会产生不同指纹', () => {
  const memory = { name: 'search_memories', description: '记忆检索', parameters: { type: 'object' } }
  const web = { name: 'web_search', description: '联网检索', parameters: { type: 'object' } }
  const key = runtimeContextKey([memory, web])
  assert.match(key, /^[a-f0-9]{64}$/u)
  assert.equal(runtimeContextKey([web, memory]), key)
  assert.notEqual(runtimeContextKey([memory]), key)
  assert.notEqual(runtimeContextKey([memory, { ...web, parameters: { type: 'object', required: ['query'] } }]), key)
})

test('恢复同版本的完整轮次，升级或回退不重放更早的能力声明，元数据持久化后仍有效', () => {
  const previousKey = runtimeContextKey([{ name: 'search_memories', description: '记忆检索', parameters: {} }])
  const currentKey = runtimeContextKey([{ name: 'web_search', description: '联网检索', parameters: {} }])
  const previous = tagRuntimeMessages(
    [
      { role: 'user', content: '查询偏好', timestamp: 1 },
      message([{ type: 'toolCall', id: 'old-call', name: 'search_memories', arguments: { query: '中文' } }], 'toolUse'),
      {
        role: 'toolResult',
        toolCallId: 'old-call',
        toolName: 'search_memories',
        content: [{ type: 'text', text: '偏好中文' }],
        isError: false,
        timestamp: 2,
      },
      message([{ type: 'text', text: '旧轮次' }]),
    ],
    previousKey,
  )
  const current = tagRuntimeMessages(
    [{ role: 'user', content: '联网查询', timestamp: 3 }, message([{ type: 'text', text: '新轮次' }])],
    currentKey,
  )
  const restored = parseHistory(JSON.parse(JSON.stringify([...previous, ...current])))
  assert.deepEqual(compatibleHistory(previous, previousKey), previous)
  assert.deepEqual(compatibleHistory(restored, currentKey), current)
  assert.deepEqual(compatibleHistory(restored, previousKey), [])
})
