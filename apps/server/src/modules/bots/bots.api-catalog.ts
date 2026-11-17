import { botApiExclusion, type BotApiMethod } from './bots.api-denylist.ts'

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : undefined
}

function requestSchema(operation: Record<string, unknown>) {
  const response = object(operation.requestBody)
  const json = object(object(response?.content)?.['application/json'])
  return json?.schema
}

/**
 * 从平台 OpenAPI 构建 Bot 可检索的 GET/POST 目录。
 * @param document 注册路由生成的接口契约。
 * @returns 含路径模板、摘要、参数及授权说明的过滤目录。
 */
export function catalogBotApis(document: unknown) {
  const paths = object(object(document)?.paths)
  if (!paths) throw new Error('平台 OpenAPI 缺少路由目录')
  const methods: BotApiMethod[] = ['GET', 'POST']
  return Object.entries(paths).flatMap(([path, item]) => {
    if (!path.startsWith('/api/v1/')) return []
    const entry = object(item)
    return methods.flatMap((method) => {
      const operation = object(entry?.[method.toLowerCase()])
      if (!operation || botApiExclusion(method, path)) return []
      return [
        {
          method,
          path,
          summary: typeof operation.summary === 'string' ? operation.summary : path,
          parameters: Array.isArray(operation.parameters) ? operation.parameters : [],
          body: requestSchema(operation),
          authorization:
            typeof operation.description === 'string' ? operation.description : '按触发人当前的团队角色和资源权限校验',
        },
      ]
    })
  })
}
