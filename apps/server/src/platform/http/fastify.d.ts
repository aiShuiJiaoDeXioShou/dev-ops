import 'fastify'

declare module 'fastify' {
  interface FastifyContextConfig {
    /**
     * 路由级幂等开关。
     * @remarks 仅原始流上传路由设置为 false：全局幂等钩子无法对请求体做稳定哈希，
     * 且冲突时不会 drain 请求体，会重置连接；其余 POST 不设置该字段。
     */
    idempotency?: boolean
  }
}
