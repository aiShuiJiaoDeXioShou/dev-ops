/** Agent 协议中需要特殊处理的业务错误码；与 agent-protocol.md 第 9 节保持一致。 */
export const AGENT_ERROR_CODES = {
  tokenInvalid: 'AGENT_TOKEN_INVALID',
  registrationTokenInvalid: 'AGENT_REGISTRATION_TOKEN_INVALID',
  nodeDisabled: 'AGENT_NODE_DISABLED',
  leaseExpired: 'AGENT_LEASE_EXPIRED',
  leaseInvalid: 'AGENT_LEASE_INVALID',
  stepStateConflict: 'AGENT_STEP_STATE_CONFLICT',
  logSeqConflict: 'AGENT_LOG_SEQ_CONFLICT',
  logLimitExceeded: 'AGENT_LOG_LIMIT_EXCEEDED',
  artifactLimitExceeded: 'AGENT_ARTIFACT_LIMIT_EXCEEDED',
  versionUnsupported: 'AGENT_VERSION_UNSUPPORTED',
  validationError: 'VALIDATION_ERROR',
  storageError: 'PIPELINE_STORAGE_ERROR',
} as const

/** 平台返回的业务失败；携带稳定错误码，调用方不得把它当作可重试的传输失败。 */
export class AgentApiError extends Error {
  readonly code: string
  readonly requestId?: string
  /** 平台在失败信封中附带的原始 data，用于读取 acceptedThrough 等协议信息。 */
  readonly data: unknown

  constructor(code: string, message: string, requestId?: string, data?: unknown) {
    super(message || code)
    this.name = 'AgentApiError'
    this.code = code
    this.data = data
    if (requestId) this.requestId = requestId
  }
}

/** 网络、超时、HTTP 状态或响应格式错误；客户端已按次数上限重试过。 */
export class AgentTransportError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'AgentTransportError'
  }
}

/** 取出错误中的安全描述文本；错误对象可能来自任意库，因此不承诺包含堆栈。 */
export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return '未知错误'
}

/** 判断错误是否为指定业务错误码。 */
export function isAgentErrorCode(error: unknown, code: string): boolean {
  return error instanceof AgentApiError && error.code === code
}

/** 读取业务错误 data 中以字符串为键的数字字段，用于处理日志序号冲突。 */
export function readErrorNumberRecord(error: unknown, key: string): Readonly<Record<string, number>> | undefined {
  if (!(error instanceof AgentApiError)) return undefined
  const data = error.data
  if (typeof data !== 'object' || data === null) return undefined
  const candidate = Reflect.get(data, key)
  if (typeof candidate !== 'object' || candidate === null) return undefined
  const result: Record<string, number> = {}
  for (const [entryKey, entryValue] of Object.entries(candidate)) {
    if (typeof entryValue === 'number' && Number.isInteger(entryValue) && entryValue >= 0) result[entryKey] = entryValue
  }
  return result
}

/** 租约已过期或不再属于本节点；必须立即停止本地执行并清理，不上报成功。 */
export function isLeaseLostError(error: unknown): boolean {
  return (
    isAgentErrorCode(error, AGENT_ERROR_CODES.leaseExpired) ||
    isAgentErrorCode(error, AGENT_ERROR_CODES.leaseInvalid) ||
    isAgentErrorCode(error, AGENT_ERROR_CODES.stepStateConflict)
  )
}

/**
 * 判断错误是否意味着 Agent 应停止工作。
 * @param error 客户端抛出的错误。
 * @returns 令牌失效、注册令牌失效、版本不兼容或节点停用时为真；节点停用只需停止领取任务。
 * @remarks 返回原因用于区分“必须退出”和“只停止领取”；网络错误不算终止条件。
 */
export function classifyFatalError(error: unknown): 'exit' | 'stop-claiming' | null {
  if (isAgentErrorCode(error, AGENT_ERROR_CODES.tokenInvalid)) return 'exit'
  if (isAgentErrorCode(error, AGENT_ERROR_CODES.registrationTokenInvalid)) return 'exit'
  if (isAgentErrorCode(error, AGENT_ERROR_CODES.versionUnsupported)) return 'exit'
  if (isAgentErrorCode(error, AGENT_ERROR_CODES.nodeDisabled)) return 'stop-claiming'
  return null
}
