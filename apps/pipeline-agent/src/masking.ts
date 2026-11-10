/** 脱敏替换文本；不保留原值长度，避免泄露敏感信息规模。 */
export const MASKED_TEXT = '***'

/** 需要在日志与错误信息中遮蔽的敏感键名（大小写不敏感）。 */
const SENSITIVE_KEY_PATTERN =
  /((?:password|passwd|pwd|token|secret|api[_-]?key|apikey|access[_-]?key|private[_-]?key|credential|authorization)\s*["']?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;]+)/gi

/** 已知平台与常见服务的令牌前缀；命中即整体遮蔽。 */
const TOKEN_PATTERNS: readonly RegExp[] = [
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bnpm_[A-Za-z0-9]{30,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
]

/** HTTP 认证头中的 Bearer/Basic 凭据；优先整体遮蔽，避免只遮蔽认证方案名。 */
const AUTH_SCHEME_PATTERN = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/g

/** URL 内嵌凭据（user:password@host）；匹配后只保留用户名。 */
const URL_CREDENTIAL_PATTERN = /(\b[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+):[^/\s@]+@/gi

/** 脱敏器：先按已知密钥整串替换，再处理通用敏感模式。 */
export interface SecretMasker {
  /** 注册一个或多个敏感值；过短的值不注册，避免把普通文本替换得不可读。 */
  addSecrets(values: readonly string[]): void
  /** 返回脱敏后的文本；输入为空时原样返回。 */
  maskText(text: string): string
}

/**
 * 根据已知敏感值创建脱敏器。
 * @param initialSecrets 初始敏感值（令牌、Git 凭据、运行时密钥等），只在内存中保存。
 * @returns 可增量注册敏感值的脱敏器；输出不会包含原始敏感值与常见令牌格式。
 * @remarks 通用模式也会遮蔽形如 password=... 的文本，因此可能对普通日志做保守遮蔽。
 */
export function createSecretMasker(initialSecrets: readonly string[] = []): SecretMasker {
  const secrets = new Set<string>()

  function register(value: string): void {
    const trimmed = value.trim()
    // 过短的值（如 1、true）会把正常日志替换得不可读，且不具备保密意义。
    if (trimmed.length >= 4) secrets.add(trimmed)
  }

  function maskText(text: string): string {
    let masked = text
    // 先替换较长值，避免短值先替换破坏长值匹配。
    const ordered = [...secrets].sort((left, right) => right.length - left.length)
    for (const secret of ordered) {
      if (masked.includes(secret)) masked = masked.split(secret).join(MASKED_TEXT)
    }
    masked = masked.replace(AUTH_SCHEME_PATTERN, `$1 ${MASKED_TEXT}`)
    masked = masked.replace(URL_CREDENTIAL_PATTERN, `$1:${MASKED_TEXT}@`)
    masked = masked.replace(SENSITIVE_KEY_PATTERN, `$1${MASKED_TEXT}`)
    for (const pattern of TOKEN_PATTERNS) masked = masked.replace(pattern, MASKED_TEXT)
    return masked
  }

  for (const secret of initialSecrets) register(secret)
  return {
    addSecrets(values: readonly string[]): void {
      for (const value of values) register(value)
    },
    maskText,
  }
}

/**
 * 使用通用模式遮蔽文本中的凭据与令牌，不依赖调用方先注册敏感值。
 * @param text 原始文本。
 * @returns 遮蔽后的文本；用于错误摘要与兜底日志。
 */
export function maskSensitiveText(text: string): string {
  const masker = createSecretMasker()
  return masker.maskText(text)
}
