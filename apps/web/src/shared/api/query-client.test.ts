import { describe, expect, it } from 'vitest'
import { RequestError } from '@dev-ops/api-client'
import { createQueryClient, shouldRetryQuery } from './query-client'

function requestError(code: ConstructorParameters<typeof RequestError>[1]['code'], status?: number) {
  return new RequestError('失败', { code, status })
}

describe('shouldRetryQuery', () => {
  it('只对暂时性读取失败允许一次重试', () => {
    expect(shouldRetryQuery(0, requestError('NETWORK_ERROR'))).toBe(true)
    expect(shouldRetryQuery(0, requestError('TIMEOUT'))).toBe(true)
    expect(shouldRetryQuery(0, requestError('HTTP_ERROR', 503))).toBe(true)
    expect(shouldRetryQuery(1, requestError('NETWORK_ERROR'))).toBe(false)
  })

  it('不重试业务、权限、参数、契约错误和未知异常', () => {
    expect(shouldRetryQuery(0, requestError('BUSINESS_ERROR', 200))).toBe(false)
    expect(shouldRetryQuery(0, requestError('HTTP_ERROR', 403))).toBe(false)
    expect(shouldRetryQuery(0, requestError('INVALID_RESPONSE', 200))).toBe(false)
    expect(shouldRetryQuery(0, new Error('unknown'))).toBe(false)
  })
})

describe('createQueryClient', () => {
  it('读取缓存有界，写操作不自动重试', () => {
    const client = createQueryClient()
    const queries = client.getDefaultOptions().queries
    const mutations = client.getDefaultOptions().mutations
    expect(queries?.staleTime).toBe(30_000)
    expect(queries?.gcTime).toBe(5 * 60_000)
    expect(queries?.retry).toBe(shouldRetryQuery)
    expect(queries?.retryDelay).toBe(500)
    expect(mutations?.retry).toBe(false)
  })
})
