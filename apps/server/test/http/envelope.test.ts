import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ERROR_CODES } from '../../src/platform/http/error-codes.ts'
import { failure, success } from '../../src/platform/http/response.ts'

test('成功信封包含固定成功码、请求标识与业务数据', () => {
  assert.deepEqual(success({ id: '42' }, 'trace'), {
    success: true,
    code: 'OK',
    message: 'OK',
    requestId: 'trace',
    data: { id: '42' },
  })
})

test('失败信封使用登记的业务错误码，按需携带结构化错误信息', () => {
  assert.deepEqual(failure(ERROR_CODES.VERSION_CONFLICT, '内容已更新', 'trace', { currentVersion: 3 }), {
    success: false,
    code: ERROR_CODES.VERSION_CONFLICT,
    message: '内容已更新',
    requestId: 'trace',
    data: { currentVersion: 3 },
  })
  assert.deepEqual(failure(ERROR_CODES.NOT_FOUND, '接口不存在', 'trace'), {
    success: false,
    code: ERROR_CODES.NOT_FOUND,
    message: '接口不存在',
    requestId: 'trace',
  })
})
