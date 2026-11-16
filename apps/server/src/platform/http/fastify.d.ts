import 'fastify'

declare module 'fastify' {
  interface FastifyContextConfig {
    /**
     * 全局幂等登记开关。
     * @remarks 业务自行登记幂等或读取原始上传流的路由设置为 false。全局钩子无法对原始流做稳定哈希，
     * 在读取完请求流前返回冲突也可能重置连接。
     */
    idempotency?: boolean
  }
}
