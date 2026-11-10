import { createApiClient } from '@dev-ops/api-client'

// 浏览器部署信息只在此处适配，功能模块不读取 window 或拼接部署域名。
export const apiClient = createApiClient({
  baseUrl: window.location.origin,
  credentials: 'same-origin',
  // GitHub 仓库同步等外部读取实测接近 5 秒，默认超时会在正常操作时误报；业务请求本身仍有服务端超时约束。
  timeoutMs: 15_000,
  ...(import.meta.env.MODE === 'test' ? { validateResponses: false } : {}),
})
