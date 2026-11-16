export const GATEWAY_FAILURES = {
  502: {
    title: '暂时无法连接服务',
    description: '上游服务未返回有效响应（HTTP 502），请稍后重新加载。',
    mascot: 'signal',
  },
  503: {
    title: '服务暂时不可用',
    description: '服务可能正在维护或繁忙（HTTP 503），请稍后重试。',
    mascot: 'signal',
  },
  504: {
    title: '服务响应超时',
    description: '等待上游服务响应超时（HTTP 504），请稍后重试。',
    mascot: 'signal',
  },
} as const
