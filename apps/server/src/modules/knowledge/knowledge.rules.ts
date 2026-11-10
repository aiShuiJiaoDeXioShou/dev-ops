import { ApiError } from '../../platform/http/errors.ts'
import { ERROR_CODES } from '../../platform/http/error-codes.ts'
import {
  SKILL_CATEGORIES,
  SKILL_CONTENT_VERSION_PATTERN,
  SKILL_IDENTIFIER_PATTERN,
  type SkillCategory,
} from './knowledge.types.ts'

/** 技能名称长度上限。 */
export const SKILL_NAME_MAX_LENGTH = 30
/** 技能调用标识长度上限。 */
export const SKILL_IDENTIFIER_MAX_LENGTH = 40
/** 技能简述长度上限。 */
export const SKILL_SUMMARY_MAX_LENGTH = 100
/** 技能指令正文长度上限。 */
export const SKILL_CONTENT_MAX_LENGTH = 6000
/** 模板名称长度上限。 */
export const TEMPLATE_NAME_MAX_LENGTH = 40
/** 模板分类标签长度上限。 */
export const TEMPLATE_TAG_MAX_LENGTH = 30
/** 模板说明长度上限。 */
export const TEMPLATE_DESCRIPTION_MAX_LENGTH = 200
/** 模板正文长度上限。 */
export const TEMPLATE_CONTENT_MAX_LENGTH = 20000
/** 快照令牌字符长度。 */
export const SNAPSHOT_TOKEN_LENGTH = 43

/**
 * 高置信凭据特征；只用于拒绝明显把真实密钥写入知识内容的输入。
 * 不覆盖通用敏感信息扫描，避免误伤正常文本。
 */
const SENSITIVE_CONTENT_PATTERNS: ReadonlyArray<RegExp> = [
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/,
  /\bsk-[A-Za-z0-9]{20,}\b/,
  /\bghp_[A-Za-z0-9]{30,}\b/,
  /\bgho_[A-Za-z0-9]{30,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
  /\bBearer\s+[A-Za-z0-9._-]{20,}\b/,
]

/**
 * 去除首尾空白并校验非空与长度。
 * @param value 原始文本。
 * @param name 字段中文名称，用于错误信息。
 * @param maxLength 最大字符数。
 * @returns 裁剪后的文本。
 * @throws 为空或超长时抛出 VALIDATION_ERROR。
 */
export function requiredText(value: string, name: string, maxLength: number): string {
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > maxLength) {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, `${name}长度必须在 1-${maxLength} 个字符之间`)
  }
  return trimmed
}

/**
 * 去除首尾空白并校验可选文本长度。
 * @param value 原始文本或 null/undefined。
 * @param name 字段中文名称。
 * @param maxLength 最大字符数。
 * @returns 裁剪后的文本；空文本返回 null。
 * @throws 超长时抛出 VALIDATION_ERROR。
 */
export function optionalText(value: string | null | undefined, name: string, maxLength: number): string | null {
  if (value === undefined || value === null) return null
  const trimmed = value.trim()
  if (trimmed.length === 0) return null
  if (trimmed.length > maxLength) {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, `${name}不能超过 ${maxLength} 个字符`)
  }
  return trimmed
}

/**
 * 校验技能调用标识。
 * @param value 原始标识。
 * @returns 裁剪后的标识。
 * @throws 格式不合法时抛出 VALIDATION_ERROR。
 */
export function validateSkillIdentifier(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length < 2 || trimmed.length > SKILL_IDENTIFIER_MAX_LENGTH || !SKILL_IDENTIFIER_PATTERN.test(trimmed)) {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '调用标识只允许小写字母、数字和连字符')
  }
  return trimmed
}

/**
 * 校验技能分类。
 * @param value 原始分类。
 * @returns 收窄后的分类。
 * @throws 不在允许集合时抛出 VALIDATION_ERROR。
 */
export function validateSkillCategory(value: string): SkillCategory {
  if (!(SKILL_CATEGORIES as readonly string[]).includes(value)) {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '技能分类不合法')
  }
  return value as SkillCategory
}

/**
 * 校验技能内容版本。
 * @param value 原始版本号。
 * @returns 裁剪后的三段式版本。
 * @throws 格式不合法时抛出 VALIDATION_ERROR。
 */
export function validateSkillContentVersion(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > 20 || !SKILL_CONTENT_VERSION_PATTERN.test(trimmed)) {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '技能版本需要形如 1.0.0')
  }
  return trimmed
}

/**
 * 校验技能指令正文并拒绝疑似凭据内容。
 * @param value 原始正文。
 * @returns 裁剪后的正文。
 * @throws 为空、超长或疑似含凭据时抛出 VALIDATION_ERROR。
 */
export function validateSkillContent(value: string): string {
  const content = requiredText(value, 'SKILL.md 指令', SKILL_CONTENT_MAX_LENGTH)
  assertNoSensitiveContent(content)
  return content
}

/**
 * 校验模板正文并拒绝疑似凭据内容。
 * @param value 原始正文。
 * @returns 裁剪后的正文。
 * @throws 为空、超长或疑似含凭据时抛出 VALIDATION_ERROR。
 */
export function validateTemplateContent(value: string): string {
  const content = requiredText(value, 'AGENTS.md 正文', TEMPLATE_CONTENT_MAX_LENGTH)
  assertNoSensitiveContent(content)
  return content
}

/**
 * 计算模板名称的比较键：去首尾空白后转小写。
 * @param name 模板名称。
 * @returns 用于团队内唯一比较的规范化名称。
 */
export function templateNameKey(name: string): string {
  return name.trim().toLowerCase()
}

/**
 * 校验内容中是否包含高置信凭据模式。
 * @param content 技能或模板正文。
 * @returns 无返回值。
 * @throws 命中模式时抛出 VALIDATION_ERROR；错误信息不回显匹配内容。
 */
export function assertNoSensitiveContent(content: string): void {
  if (SENSITIVE_CONTENT_PATTERNS.some((pattern) => pattern.test(content))) {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '内容疑似包含密钥或访问凭据，请不要写入知识资产')
  }
}

/**
 * 转义 SQL LIKE 通配符，避免用户输入改变检索语义。
 * @param value 原始检索词。
 * @returns 可直接用于 `ILIKE` 的转义文本（不含首尾 `%`）。
 */
export function escapeLikeTerm(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
}
