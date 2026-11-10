import { ApiError } from '../../platform/http/errors.ts'
import { ERROR_CODES } from '../../platform/http/error-codes.ts'
import {
  SKILL_CATEGORIES,
  SKILL_CONTENT_VERSION_PATTERN,
  SKILL_IDENTIFIER_PATTERN,
  type SkillCategory,
  type SkillFileStored,
} from './knowledge.types.ts'

/** 技能名称长度上限。 */
export const SKILL_NAME_MAX_LENGTH = 30
/** 技能调用标识长度上限。 */
export const SKILL_IDENTIFIER_MAX_LENGTH = 40
/** 技能简述长度上限。 */
export const SKILL_SUMMARY_MAX_LENGTH = 100
/** 技能指令正文长度上限。 */
export const SKILL_CONTENT_MAX_LENGTH = 50_000
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
/** 单个技能最多资源文件数量。 */
export const SKILL_FILE_MAX_COUNT = 50
/** 单个 UTF-8 资源文件最大字符数。 */
export const SKILL_FILE_TEXT_MAX_LENGTH = 120_000
/** 单个二进制资源文件最大字节数。 */
export const SKILL_FILE_BINARY_MAX_BYTES = 200 * 1024
/** 技能资源文件解码后总字节数上限。 */
export const SKILL_FILES_TOTAL_MAX_BYTES = 400 * 1024
/** 资源文件路径最大字符数。 */
export const SKILL_FILE_PATH_MAX_LENGTH = 200

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

const SKILL_FILE_PATH_SEGMENT = /^[A-Za-z0-9._-]+$/

/**
 * 校验资源文件路径：相对技能根目录、禁止穿越与保留文件。
 * @param value 原始路径。
 * @returns 归一化后的路径。
 * @throws 路径为空、绝对路径、包含穿越段或非法字符时抛出 VALIDATION_ERROR。
 */
export function validateSkillFilePath(value: string): string {
  const path = value.trim().replace(/\\/g, '/')
  if (path.length === 0 || path.length > SKILL_FILE_PATH_MAX_LENGTH) {
    throw new ApiError(
      ERROR_CODES.VALIDATION_ERROR,
      `资源文件路径长度必须在 1-${SKILL_FILE_PATH_MAX_LENGTH} 个字符之间`,
    )
  }
  if (path.startsWith('/') || path.endsWith('/')) {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '资源文件路径必须是相对路径，且不能以斜杠开头或结尾')
  }
  const segments = path.split('/')
  if (
    segments.some(
      (segment) => segment === '' || segment === '.' || segment === '..' || !SKILL_FILE_PATH_SEGMENT.test(segment),
    )
  ) {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '资源文件路径只能包含字母、数字、点、下划线、连字符和目录斜杠')
  }
  if (path.toLowerCase() === 'skill.md') {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, 'SKILL.md 由技能正文维护，不能作为资源文件重复添加')
  }
  return path
}

/**
 * 估算 base64 内容解码后的字节数。
 * @param content base64 文本（允许换行）。
 * @returns 解码后的字节数；非法 base64 返回 -1。
 */
function base64DecodedBytes(content: string): number {
  const normalized = content.replace(/\s+/g, '')
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized) || normalized.length % 4 !== 0) return -1
  return Math.floor((normalized.length * 3) / 4) - (normalized.endsWith('==') ? 2 : normalized.endsWith('=') ? 1 : 0)
}

/**
 * 校验技能资源文件集合，去重并计算大小。
 * @param files 客户端提交的资源文件。
 * @returns 已校验的资源文件；路径按字典序稳定排序。
 * @throws 数量、路径、编码、大小或敏感内容不合法时抛出 VALIDATION_ERROR。
 */
export function validateSkillFiles(
  files: readonly { path: string; content: string; encoding: string }[],
): SkillFileStored[] {
  if (files.length > SKILL_FILE_MAX_COUNT) {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, `资源文件最多 ${SKILL_FILE_MAX_COUNT} 个`)
  }
  const seen = new Set<string>()
  let totalBytes = 0
  const stored = files.map((file) => {
    const path = validateSkillFilePath(file.path)
    if (seen.has(path)) {
      throw new ApiError(ERROR_CODES.VALIDATION_ERROR, `资源文件路径重复：${path}`)
    }
    seen.add(path)
    if (file.encoding !== 'utf8' && file.encoding !== 'base64') {
      throw new ApiError(ERROR_CODES.VALIDATION_ERROR, `资源文件编码不合法：${path}`)
    }
    let sizeBytes: number
    if (file.encoding === 'utf8') {
      if (file.content.length === 0 || file.content.length > SKILL_FILE_TEXT_MAX_LENGTH) {
        throw new ApiError(
          ERROR_CODES.VALIDATION_ERROR,
          `资源文件 ${path} 内容长度必须在 1-${SKILL_FILE_TEXT_MAX_LENGTH} 个字符之间`,
        )
      }
      sizeBytes = Buffer.byteLength(file.content, 'utf8')
      assertNoSensitiveContent(file.content)
    } else {
      sizeBytes = base64DecodedBytes(file.content)
      if (sizeBytes < 0) {
        throw new ApiError(ERROR_CODES.VALIDATION_ERROR, `资源文件 ${path} 不是合法的 base64`)
      }
      if (sizeBytes > SKILL_FILE_BINARY_MAX_BYTES) {
        throw new ApiError(
          ERROR_CODES.VALIDATION_ERROR,
          `资源文件 ${path} 超过 ${SKILL_FILE_BINARY_MAX_BYTES} 字节上限`,
        )
      }
    }
    totalBytes += sizeBytes
    return { path, content: file.content, encoding: file.encoding as 'utf8' | 'base64', sizeBytes }
  })
  if (totalBytes > SKILL_FILES_TOTAL_MAX_BYTES) {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, `资源文件总大小不能超过 ${SKILL_FILES_TOTAL_MAX_BYTES} 字节`)
  }
  return stored.sort((left, right) => left.path.localeCompare(right.path))
}
