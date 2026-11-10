import { RequestError } from '@dev-ops/api-client'
import { describe, expect, it } from 'vitest'
import { describeRequestError } from './errors'

/** 构造与 api-client 一致的业务失败错误，便于断言错误码到文案的映射。 */
function businessError(serverCode: string) {
  return new RequestError('操作未完成，请稍后重试。', {
    code: 'BUSINESS_ERROR',
    status: 200,
    requestId: 'req-1',
    responseValid: true,
    serverCode,
  })
}

describe('describeRequestError', () => {
  it('敏感操作错误码映射为可读说明并保留请求标识', () => {
    expect(describeRequestError(businessError('PASSWORD_INVALID'))).toEqual({
      description: '登录密码错误，请重试。',
      requestId: 'req-1',
    })
    expect(describeRequestError(businessError('RATE_LIMITED')).description).toBe('操作过于频繁，请稍后再试。')
    expect(describeRequestError(businessError('CREDENTIAL_UNAVAILABLE')).description).toBe('凭据已撤销或已过期。')
  })

  it('未登记错误码保留客户端安全说明，不使用服务端正文', () => {
    expect(describeRequestError(businessError('SOME_NEW_CODE')).description).toBe('操作未完成，请稍后重试。')
  })

  it('非请求错误返回通用网络提示', () => {
    expect(describeRequestError(new Error('boom'))).toEqual({
      description: '请求失败，请检查网络后重试。',
      requestId: null,
    })
  })
})
