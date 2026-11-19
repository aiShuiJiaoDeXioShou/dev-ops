export type BotApiMethod = 'GET' | 'POST'

export type BotApiExclusion =
  | 'team_membership'
  | 'credentials'
  | 'tokens'
  | 'capability_grants'
  | 'change_approval'
  | 'skills_management'
  | 'bot_management'
  | 'authentication'

type Rule = {
  category: BotApiExclusion
  methods?: readonly BotApiMethod[]
  path: RegExp
}

// 与 research.md R5 的类别和路径约定保持一致。登录会话沿用模型连接所属类别。
const rules: readonly Rule[] = [
  { category: 'team_membership', methods: ['POST'], path: /^\/teams\/[^/]+\/members(?:\/|$)/u },
  { category: 'team_membership', path: /^\/(?:teams\/[^/]+\/)?invitations(?:\/|$)/u },
  { category: 'credentials', path: /^\/(?:teams\/[^/]+\/)?credentials(?:\/|$)/u },
  { category: 'credentials', path: /^\/projects\/[^/]+\/environments(?:\/|$)/u },
  { category: 'credentials', path: /^\/project-variables(?:\/|$)/u },
  { category: 'tokens', path: /^\/(?:me|pipeline-nodes\/[^/]+)\/tokens(?:\/|$)/u },
  { category: 'capability_grants', path: /^\/projects\/[^/]+\/tools\/grants(?:\/|$)/u },
  { category: 'change_approval', path: /^\/change-plans\/[^/]+\/approve$/u },
  { category: 'skills_management', methods: ['POST'], path: /^\/(?:teams\/[^/]+\/)?skills(?:\/|$)/u },
  { category: 'bot_management', methods: ['POST'], path: /^\/(?:teams\/[^/]+\/)?bots(?:\/|$)/u },
  { category: 'bot_management', path: /^\/(?:teams\/[^/]+\/)?bot-model-connections(?:\/|$)/u },
  {
    category: 'bot_management',
    methods: ['POST'],
    path: /^\/bot-conversations\/[^/]+\/bots\/[^/]+\/(?:compact|reseed)$/u,
  },
  { category: 'bot_management', path: /^\/bot-model-login-sessions(?:\/|$)/u },
  { category: 'bot_management', path: /^\/bot-tasks\/[^/]+\/(?:accept|request-changes)$/u },
  { category: 'authentication', path: /^\/auth(?:\/|$)/u },
]

/**
 * 匹配 R5 排除项，可用于具体请求路径或 OpenAPI 路由模板。
 * @param method 契约支持的 HTTP 方法。
 * @param path /api/v1 下不含查询串的路径。
 * @returns 需要由成员本人操作的类别；未命中时返回 undefined。
 */
export function botApiExclusion(method: BotApiMethod, path: string): BotApiExclusion | undefined {
  const relative = path.replace(/^\/api\/v1(?=\/)/u, '')
  return rules.find((rule) => (!rule.methods || rule.methods.includes(method)) && rule.path.test(relative))?.category
}
