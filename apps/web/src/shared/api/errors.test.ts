import { RequestError } from '@dev-ops/api-client'
import { describe, expect, it } from 'vitest'
import { describeRequestError } from './errors'

/** 构造与 api-client 一致的业务失败错误，便于断言错误码到文案的映射。 */
function businessError(serverCode: string, data?: unknown) {
  return new RequestError('操作未完成，请稍后重试。', {
    code: 'BUSINESS_ERROR',
    status: 200,
    requestId: 'req-1',
    responseValid: true,
    serverCode,
    data,
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

  it.each([
    [{ reason: 'disabled' }, '智能体已停用，请启用后重试。'],
    [{ reason: 'model_unbound' }, '智能体尚未绑定模型，请联系团队管理员配置模型连接并绑定模型。'],
    [{ reason: 'model_unavailable' }, '智能体绑定的模型不可用，请联系团队管理员检查模型连接。'],
    [{ reason: 'worker_offline' }, 'Bot 执行服务离线，请在服务恢复后重试。'],
    [{ reason: '未识别的服务端内容' }, '智能体暂时无法运行，请检查智能体配置与执行服务状态。'],
    [undefined, '智能体暂时无法运行，请检查智能体配置与执行服务状态。'],
  ])('智能体不可用时把原因 %j 映射为安全的说明', (data, description) => {
    expect(describeRequestError(businessError('BOT_UNAVAILABLE', data))).toEqual({ description, requestId: 'req-1' })
  })

  it('非请求错误返回通用网络提示', () => {
    expect(describeRequestError(new Error('boom'))).toEqual({
      description: '请求失败，请检查网络后重试。',
      requestId: null,
    })
  })
})
