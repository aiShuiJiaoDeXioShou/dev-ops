export type BotApiMethod = 'GET' | 'POST'

export type BotApiExclusion = 'team_membership' | 'credentials' | 'tokens' | 'authentication'

type Rule = {
  category: BotApiExclusion
  methods?: readonly BotApiMethod[]
  path: RegExp
}

// 运行令牌只排除成员、登录、凭据明文和令牌签发；业务权限由路由继续校验。
const rules: readonly Rule[] = [
  { category: 'tokens', methods: ['POST'], path: /^\/teams\/[^/]+\/pipeline-nodes$/u },
  { category: 'tokens', methods: ['POST'], path: /^\/agent\/register$/u },
  { category: 'team_membership', path: /^\/(?:teams|projects|bot-conversations)\/[^/]+\/members(?:\/|$)/u },
  { category: 'team_membership', path: /^\/(?:teams\/[^/]+\/)?invitations(?:\/|$)/u },
  { category: 'tokens', methods: ['POST'], path: /^\/me\/tokens$/u },
  { category: 'tokens', methods: ['POST'], path: /^\/pipeline-nodes\/[^/]+\/tokens\/rotate$/u },
  { category: 'credentials', path: /^\/credentials\/[^/]+\/reveal-value$/u },
  { category: 'authentication', path: /^\/me\/github-account\/(?:authorize|disconnect)$/u },
  { category: 'authentication', path: /^\/auth(?:\/|$)/u },
  { category: 'authentication', path: /^\/teams\/[^/]+\/bot-model-connections\/oauth-login$/u },
  { category: 'authentication', path: /^\/bot-model-login-sessions(?:\/|$)/u },
]

/**
 * 匹配 Bot 运行令牌排除项，可用于具体请求路径或 OpenAPI 路由模板。
 * @param method 契约支持的 HTTP 方法。
 * @param path /api/v1 下不含查询串的路径。
 * @returns 需要由成员本人操作的类别；未命中时返回 undefined。
 */
export function botApiExclusion(method: BotApiMethod, path: string): BotApiExclusion | undefined {
  if (/^\/api\/auth(?:\/|$)/u.test(path)) return 'authentication'
  const relative = path.replace(/^\/api\/v1(?=\/)/u, '')
  return rules.find((rule) => (!rule.methods || rule.methods.includes(method)) && rule.path.test(relative))?.category
}
