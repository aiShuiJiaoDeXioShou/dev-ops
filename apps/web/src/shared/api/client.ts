import { createApiClient } from '@dev-ops/api-client'

// 浏览器部署信息只在此处适配，功能模块不读取 window 或拼接部署域名。
export const apiClient = createApiClient({
  baseUrl: window.location.origin,
  credentials: 'same-origin',
  ...(import.meta.env.MODE === 'test' ? { validateResponses: false } : {}),
})
