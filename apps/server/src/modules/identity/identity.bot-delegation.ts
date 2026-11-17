import { randomBytes } from 'node:crypto'
import type { IncomingHttpHeaders } from 'node:http'
import type { SessionUser } from './identity.types.ts'

const BOT_TOKEN_PREFIX = 'bot-delegation-'

export interface BotActor {
  user: SessionUser
  credential: 'bot'
  teamId: string
  viaBotId: string
  runId: string
  leaseEpoch: number
}

/**
 * 识别内部委托的凭据前缀。前缀只区分身份类型，本身不提供授权。
 * @param token 从请求中解析的 Bearer 值。
 * @returns 是否以内部委托前缀开头。
 */
export function isBotDelegationToken(token: string): boolean {
  return token.startsWith(BOT_TOKEN_PREFIX)
}

/**
 * 为单个进程内 HTTP 实例建立一次性委托凭据存储。
 * @returns 签发与解析方法。凭据只在调用期间有效，同一请求的各阶段可复用已解析的身份。
 */
export function createBotDelegation() {
  const pending = new Map<string, BotActor>()
  const consumed = new WeakMap<IncomingHttpHeaders, { token: string; actor: BotActor }>()

  return {
    /**
     * 向一次进程内请求提供短期凭据，调用结束后释放未消费的凭据。
     * @param actor 已按运行、代次和触发人校验的身份。
     * @param invoke 使用 Bearer 值发起一次内部请求。
     * @returns 内部请求结果，异常向调用方传播。
     */
    async withToken<Result>(actor: BotActor, invoke: (token: string) => Promise<Result>): Promise<Result> {
      const token = BOT_TOKEN_PREFIX + randomBytes(32).toString('base64url')
      pending.set(token, actor)
      try {
        return await invoke(token)
      } finally {
        pending.delete(token)
      }
    },
    /**
     * 消费一次性凭据并绑定当前请求头对象。
     * @param token 内部委托的 Bearer 值。
     * @param headers 当前请求的原始头。
     * @returns 委托身份；不存在或已被另一请求消费时返回 null。
     */
    resolve(token: string, headers: IncomingHttpHeaders): BotActor | null {
      const previous = consumed.get(headers)
      if (previous) return previous.token === token ? previous.actor : null
      const actor = pending.get(token)
      if (!actor) return null
      pending.delete(token)
      consumed.set(headers, { token, actor })
      return actor
    },
  }
}

export type BotDelegation = ReturnType<typeof createBotDelegation>
