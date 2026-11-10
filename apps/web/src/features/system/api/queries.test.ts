import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { readinessQueryOptions } from './queries'
import { server } from '@/test/server'
import { createQueryClient, shouldRetryQuery } from '@/shared/api/query-client'
import { RequestError } from '@dev-ops/api-client'
import { apiClient } from '@/shared/api/client'

describe('请求契约与错误策略', () => {
  it('HTTP 失败保留状态和请求标识，不暴露原始错误内容', async () => {
    server.use(
      http.get('http://localhost/api/v1/ready', () =>
        HttpResponse.json(
          { message: 'SQL 和凭据等内部信息' },
          { status: 403, headers: { 'x-request-id': 'denied-request' } },
        ),
      ),
    )
    const request = apiClient.ready()
    await expect(request).rejects.toMatchObject({ code: 'HTTP_ERROR', status: 403, requestId: 'denied-request' })
    await expect(request).rejects.not.toHaveProperty('message', 'SQL 和凭据等内部信息')
  })

  it('成功状态中的非法 JSON 被报告为响应错误', async () => {
    server.use(http.get('http://localhost/api/v1/ready', () => new HttpResponse('invalid-json', { status: 200 })))
    await expect(apiClient.ready()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })

  it('调用方取消会终止请求，不转换为网络错误', async () => {
    const controller = new AbortController()
    const request = apiClient.ready(controller.signal)
    controller.abort()
    await expect(request).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('网络不可达时提供安全的连接失败提示', async () => {
    server.use(http.get('http://localhost/api/v1/ready', () => HttpResponse.error()))
    await expect(apiClient.ready()).rejects.toMatchObject({ code: 'NETWORK_ERROR' })
  })

  it('超时中断与调用方取消使用不同错误分类', async () => {
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(AbortSignal.abort(new DOMException('超时', 'TimeoutError')))
    await expect(apiClient.ready()).rejects.toMatchObject({ code: 'TIMEOUT' })
    expect(AbortSignal.timeout).toHaveBeenCalledWith(15_000)
  })

  it('权限和契约错误不重试，暂时性错误最多重试一次', () => {
    expect(shouldRetryQuery(0, new RequestError('失败', { code: 'HTTP_ERROR', status: 401 }))).toBe(false)
    expect(shouldRetryQuery(0, new RequestError('失败', { code: 'HTTP_ERROR', status: 403 }))).toBe(false)
    expect(shouldRetryQuery(0, new RequestError('失败', { code: 'INVALID_RESPONSE' }))).toBe(false)
    expect(shouldRetryQuery(0, new RequestError('失败', { code: 'HTTP_ERROR', status: 503 }))).toBe(true)
    expect(shouldRetryQuery(1, new RequestError('失败', { code: 'HTTP_ERROR', status: 503 }))).toBe(false)
  })

  it('错误的数据库就绪状态不会被缓存为成功结果', async () => {
    let requests = 0
    server.use(
      http.get('http://localhost/api/v1/ready', () => {
        requests += 1
        return HttpResponse.json({ status: 'ok', database: 'invalid' })
      }),
    )
    const client = createQueryClient()
    try {
      await expect(client.fetchQuery(readinessQueryOptions)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
      expect(client.getQueryData(readinessQueryOptions.queryKey)).toBeUndefined()
      expect(requests).toBe(1)
    } finally {
      client.clear()
    }
  })
})
