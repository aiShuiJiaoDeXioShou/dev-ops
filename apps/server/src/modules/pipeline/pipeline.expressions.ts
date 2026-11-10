import type { PipelineInputValue } from '@dev-ops/pipeline-protocol'

/** 表达式求值可用的上下文；secrets 只在明确允许的位置提供。 */
export interface ExpressionContext {
  env: Record<string, string>
  inputs: Record<string, PipelineInputValue>
  github: { sha: string; ref: string; repository: string }
  secrets?: Record<string, string>
}

/** 表达式或条件不合法；path 用于定位 workflow 字段。 */
export class PipelineExpressionError extends Error {
  readonly code = 'WORKFLOW_UNSUPPORTED'
  readonly path?: string

  constructor(message: string, path?: string) {
    super(message)
    this.name = 'PipelineExpressionError'
    this.path = path
  }
}

type ExpressionValue = string | number | boolean

const EXPRESSION_PATTERN = /\$\{\{\s*([^}]+?)\s*\}\}/g
const CONTEXT_REFERENCE = /^(env|inputs|github|secrets)\.([A-Za-z_][A-Za-z0-9_]*)$/
const GITHUB_FIELDS = new Set(['sha', 'ref', 'repository'])

/**
 * 解析受支持的单点表达式并返回运行时值。
 * @param expression 花括号内的表达式文本，如 `inputs.target`。
 * @param context 求值上下文。
 * @param options 是否允许 secrets 引用；仅在 env/with 中允许。
 * @returns 表达式对应的字符串、数字或布尔值。
 * @throws PipelineExpressionError 表达式不在支持范围、上下文缺失或 secrets 被禁用时抛出。
 */
function evaluateReference(
  expression: string,
  context: ExpressionContext,
  options: { allowSecrets: boolean },
): ExpressionValue {
  const trimmed = expression.trim()
  const match = CONTEXT_REFERENCE.exec(trimmed)
  const namespace = match?.[1]
  const key = match?.[2]
  if (!namespace || !key) {
    throw new PipelineExpressionError(`不支持的表达式：\${{\u0020${trimmed}\u0020}}`)
  }
  if (namespace === 'secrets') {
    if (!options.allowSecrets) throw new PipelineExpressionError('secrets 不能用于条件或非 env/with 位置')
    const value = context.secrets?.[key]
    if (value === undefined) throw new PipelineExpressionError(`未定义的密钥：${key}`)
    return value
  }
  if (namespace === 'github') {
    if (!GITHUB_FIELDS.has(key)) throw new PipelineExpressionError(`不支持的 github 字段：${key}`)
    return context.github[key as 'sha' | 'ref' | 'repository']
  }
  if (namespace === 'env') {
    return context.env[key] ?? ''
  }
  const value = context.inputs[key]
  if (value === undefined) return ''
  return value
}

/**
 * 把单个值中的 `${{ ... }}` 替换为求值结果；非字符串原样返回。
 * @param value 字符串、数字或布尔值。
 * @param context 求值上下文。
 * @param options 位置选项；条件与非 env 字段应禁止 secrets。
 * @returns 替换后的值；数字与布尔值保持不变。
 * @throws PipelineExpressionError 表达式不合法或引用不可用时抛出。
 */
export function resolveTemplateValue(
  value: string | number | boolean,
  context: ExpressionContext,
  options: { allowSecrets: boolean; path?: string },
): string | number | boolean {
  if (typeof value !== 'string') return value
  if (!value.includes('${{')) return value
  try {
    const replaced = value.replace(EXPRESSION_PATTERN, (_, expression: string) => {
      const result = evaluateReference(expression, context, options)
      return String(result)
    })
    return replaced
  } catch (error) {
    if (error instanceof PipelineExpressionError) {
      throw new PipelineExpressionError(error.message, options.path)
    }
    throw error
  }
}

/**
 * 把字符串中所有表达式替换为字符串结果。
 * @param value 原始字符串。
 * @param context 求值上下文。
 * @param allowSecrets 是否允许密钥引用。
 * @param path 可选的字段路径，用于错误定位。
 * @returns 替换后的字符串。
 * @throws PipelineExpressionError 表达式不合法或引用不可用时抛出。
 */
export function resolveTemplateString(
  value: string,
  context: ExpressionContext,
  allowSecrets: boolean,
  path?: string,
): string {
  return String(resolveTemplateValue(value, context, { allowSecrets, path }))
}

type ConditionToken =
  | { kind: 'operator'; value: '!' | '&&' | '||' | '==' | '!=' }
  | { kind: 'paren'; value: '(' | ')' }
  | { kind: 'value'; value: ExpressionValue }

function tokenizeCondition(expression: string): ConditionToken[] {
  const tokens: ConditionToken[] = []
  let index = 0
  while (index < expression.length) {
    const char = expression.charAt(index)
    if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
      index += 1
      continue
    }
    if (['(', ')'].includes(char)) {
      tokens.push({ kind: 'paren', value: char as '(' | ')' })
      index += 1
      continue
    }
    const pair = expression.slice(index, index + 2)
    if (pair === '&&' || pair === '||' || pair === '==' || pair === '!=') {
      tokens.push({ kind: 'operator', value: pair })
      index += 2
      continue
    }
    if (char === '!') {
      tokens.push({ kind: 'operator', value: '!' })
      index += 1
      continue
    }
    if (char === "'") {
      const end = expression.indexOf("'", index + 1)
      if (end === -1) throw new PipelineExpressionError('字符串字面量缺少结束引号')
      tokens.push({ kind: 'value', value: expression.slice(index + 1, end) })
      index = end + 1
      continue
    }
    const literal = expression.slice(index).match(/^(-?\d+(?:\.\d+)?|true|false|[A-Za-z_][A-Za-z0-9_.]*)/)
    if (!literal) throw new PipelineExpressionError(`无法识别条件片段：${expression.slice(index, index + 16)}`)
    const raw = literal[1]
    if (raw === undefined) throw new PipelineExpressionError('无法识别条件片段')
    if (raw === 'true' || raw === 'false') {
      tokens.push({ kind: 'value', value: raw === 'true' })
    } else if (/^-?\d+(?:\.\d+)?$/.test(raw)) {
      tokens.push({ kind: 'value', value: Number(raw) })
    } else {
      tokens.push({ kind: 'value', value: `\u0000ref:${raw}` })
    }
    index += raw.length
  }
  return tokens
}

function toComparable(value: ExpressionValue): string | number | boolean {
  return value
}

/**
 * 求值受支持的简单 if 条件；不支持函数、属性链与 secrets。
 * @param expression 条件表达式，可带 `${{ ... }}` 包装。
 * @param context 求值上下文。
 * @param path 可选字段路径，用于错误定位。
 * @returns 条件的布尔结果。
 * @throws PipelineExpressionError 条件语法不合法、引用不可用或结果不是布尔值时抛出。
 */
export function evaluateCondition(expression: string, context: ExpressionContext, path?: string): boolean {
  const unwrapped =
    expression.trim().startsWith('${{') && expression.trim().endsWith('}}')
      ? expression.trim().slice(3, -2).trim()
      : expression.trim()
  const tokens = tokenizeCondition(unwrapped)
  let cursor = 0

  function peek(): ConditionToken | undefined {
    return tokens[cursor]
  }

  function consume(): ConditionToken {
    const token = tokens[cursor]
    if (!token) throw new PipelineExpressionError('条件表达式不完整')
    cursor += 1
    return token
  }

  function parsePrimary(): ExpressionValue {
    const token = peek()
    if (!token) throw new PipelineExpressionError('条件表达式不完整')
    if (token.kind === 'paren' && token.value === '(') {
      consume()
      const value = parseOr()
      const close = consume()
      if (close.kind !== 'paren' || close.value !== ')') throw new PipelineExpressionError('条件括号不匹配')
      return value
    }
    if (token.kind === 'value') {
      consume()
      if (typeof token.value === 'string' && token.value.startsWith('\u0000ref:')) {
        return evaluateReference(token.value.slice(5), context, { allowSecrets: false })
      }
      return token.value
    }
    throw new PipelineExpressionError('条件表达式缺少操作数')
  }

  function parseComparison(): ExpressionValue {
    const left = parsePrimary()
    const token = peek()
    if (token?.kind === 'operator' && (token.value === '==' || token.value === '!=')) {
      consume()
      const right = parsePrimary()
      const equal = toComparable(left) === toComparable(right)
      return token.value === '==' ? equal : !equal
    }
    return left
  }

  function parseUnary(): ExpressionValue {
    const token = peek()
    if (token?.kind === 'operator' && token.value === '!') {
      consume()
      const value = parseUnary()
      if (typeof value !== 'boolean') throw new PipelineExpressionError('! 只能用于布尔值')
      return !value
    }
    return parseComparison()
  }

  function parseLogicalOperator(operator: '&&' | '||'): ExpressionValue {
    let left: ExpressionValue = operator === '&&' ? parseUnary() : parseAnd()
    for (;;) {
      const token = peek()
      if (!token || token.kind !== 'operator' || token.value !== operator) return left
      consume()
      const right = operator === '&&' ? parseUnary() : parseAnd()
      if (typeof left !== 'boolean' || typeof right !== 'boolean') {
        throw new PipelineExpressionError(`${operator} 两侧必须是布尔条件`)
      }
      left = operator === '&&' ? left && right : left || right
    }
  }

  function parseAnd(): ExpressionValue {
    return parseLogicalOperator('&&')
  }

  function parseOr(): ExpressionValue {
    return parseLogicalOperator('||')
  }

  const result = parseOr()
  if (cursor !== tokens.length) throw new PipelineExpressionError('条件表达式包含多余内容')
  if (typeof result !== 'boolean') throw new PipelineExpressionError('if 条件必须求值为布尔值', path)
  return result
}
