import type { FastifyPluginAsync } from 'fastify'
import { ERROR_CODES } from '../../platform/http/error-codes.js'
import { failure } from '../../platform/http/response.js'
import type { IdentityAuth } from './identity.auth.js'

function toHeaders(source: Record<string, string | string[] | undefined>): Headers {
  const headers = new Headers()
  for (const [name, value] of Object.entries(source)) {
    if (value === undefined) continue
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item)
    } else {
      headers.set(name, value)
    }
  }
  return headers
}

function isSignUpPath(path: string): boolean {
  return path.startsWith('/api/v1/auth/sign-up')
}

/**
 * 将 Better Auth 的 Web Request handler 桥接到 Fastify。
 * @param app Fastify 插件实例。
 * @param options Better Auth 实例。
 * @returns 注册完成的 Promise；认证端点保留库协议状态码，不套用业务信封。
 * @remarks V0.1 不开放浏览器自助注册，/auth/sign-up 路径由桥接拒绝；
 * 邀请接受流程由服务端内部调用认证 API。
 */
export const identityAuthRoutes: FastifyPluginAsync<{ auth: IdentityAuth; origin: string }> = async (app, options) => {
  app.route({
    method: ['GET', 'POST'],
    url: '/auth/*',
    handler: async (request, reply) => {
      if (isSignUpPath(request.url)) {
        return reply.code(404).send(failure(ERROR_CODES.NOT_FOUND, '接口不存在', request.id))
      }

      const url = new URL(request.url, options.origin)
      const headers = toHeaders(request.headers as Record<string, string | string[] | undefined>)
      const init: RequestInit = { method: request.method, headers }
      if (request.method !== 'GET' && request.body !== undefined) {
        init.body = JSON.stringify(request.body)
        headers.set('content-type', 'application/json')
      }

      const response = await options.auth.handler(new Request(url, init))
      reply.status(response.status)
      for (const [name, value] of response.headers.entries()) {
        if (['content-length', 'content-encoding', 'transfer-encoding', 'set-cookie'].includes(name.toLowerCase()))
          continue
        reply.header(name, value)
      }
      const cookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : []
      if (cookies.length > 0) reply.header('set-cookie', cookies)

      const body = await response.text()
      return reply.send(body)
    },
  })
}
