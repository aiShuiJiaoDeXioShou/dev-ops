import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'

/** 仅在测试中拦截网络，未声明的请求由测试配置报告错误。 */
export const server = setupServer(
  http.get('http://localhost/api/v1/ready', () => HttpResponse.json(
    { status: 'ok', database: 'ok' },
    { headers: { 'x-request-id': 'test-request' } },
  )),
)
