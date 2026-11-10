import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createAssistantMessageEventStream, type AssistantMessage } from '@earendil-works/pi-ai'
import type { StreamFn } from '@earendil-works/pi-agent-core'
import { chat } from '../src/bot.ts'
import { loadConfig } from '../src/config.ts'
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
