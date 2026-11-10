/** 敏感字段名判断：日志、错误信息与输入摘要按字段名再脱敏一次。 */
const SENSITIVE_FIELD_NAME = /token|secret|password|passwd|api[-_]?key|credential|authorization|private[-_]?key/i

/** 常见凭据形态；命中后统一替换为星号，不尝试还原原文。 */
const SENSITIVE_PATTERNS: ReadonlyArray<{ pattern: RegExp; replacement: string }> = [
  // HTTP Authorization 头与常见 Bearer 令牌。
  { pattern: /(bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, replacement: '$1***' },
  // 键值形式的令牌、密码与密钥；保留字段名，便于排障时定位哪一项被脱敏。
  {
    pattern: /((?:token|password|passwd|secret|api[-_]?key|authorization)\s*[=:]\s*)[^\s,;'"]+/gi,
    replacement: '$1***',
  },
  // 数据库连接串中的口令。
  { pattern: /(postgres(?:ql)?:\/\/[^:\s/@]+:)[^@\s]+@/gi, replacement: '$1***@' },
  // URL 内嵌凭据。
  { pattern: /(https?:\/\/[^:\s/@]+:)[^@\s]+@/gi, replacement: '$1***@' },
  // 平台、GitHub 与 Git 常见令牌前缀。
  {
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|devops_pat_[A-Za-z0-9_-]{20,})\b/g,
    replacement: '***',
  },
]

/** 单条日志或错误文本的最大保留长度，防止超大字符串进入响应与数据库。 */
export const MASKED_TEXT_MAX_LENGTH = 4_000

/** 判断字段名是否表示敏感值。 */
export function isSensitiveFieldName(name: string): boolean {
  return SENSITIVE_FIELD_NAME.test(name)
}

/**
 * 对日志、错误信息与输入值做服务端脱敏。
 * @param text 原始文本；调用方保证已限制大小。
 * @param knownSecrets 已知明文密钥（例如运行时 secrets），会按原文替换为星号。
 * @returns 脱敏后的文本；长度超过上限时截断并标记。
 * @remarks 只做确定性替换，不记录原文；Agent 侧已脱敏一层，这里是平台侧兜底。
 */
export function maskSensitiveText(text: string, knownSecrets: readonly string[] = []): string {
  let masked = text
  for (const secret of knownSecrets) {
    // 过短的“密钥”替换会破坏正常日志，仅处理长度足够的明文。
    if (secret.length < 8) continue
    masked = masked.split(secret).join('***')
  }
  for (const { pattern, replacement } of SENSITIVE_PATTERNS) {
    masked = masked.replace(pattern, replacement)
  }
  if (masked.length > MASKED_TEXT_MAX_LENGTH) {
    return `${masked.slice(0, MASKED_TEXT_MAX_LENGTH)}…[已截断]`
  }
  return masked
}

/**
 * 脱敏错误摘要；错误消息可能包含 Git 凭据或连接串。
 * @param message 原始错误消息。
 * @returns 脱敏并截断后的消息；空值返回 null。
 */
export function maskErrorMessage(message: string | null | undefined): string | null {
  if (message === null || message === undefined) return null
  const trimmed = message.trim()
  if (trimmed.length === 0) return null
  return maskSensitiveText(trimmed)
}

/**
 * 对触发输入摘要脱敏：敏感字段名的字符串值整体星号化，其余值做模式脱敏。
 * @param name 输入名。
 * @param value 输入字符串值。
 * @returns 可展示的输入值。
 */
export function maskInputValue(name: string, value: string): string {
  if (isSensitiveFieldName(name)) return '***'
  return maskSensitiveText(value)
}
