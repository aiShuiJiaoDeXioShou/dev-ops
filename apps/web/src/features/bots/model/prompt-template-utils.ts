/** 提示模板正文中的参数占位符标识。 */
export const PROMPT_ARGUMENTS_TOKEN = '$ARGUMENTS'

/** 拆分后的提示模板正文片段。 */
export interface PromptTemplateSegment {
  text: string
  isArgument: boolean
}

/**
 * 判断提示模板正文是否包含 `$ARGUMENTS` 动态参数。
 * @param body 模板正文。
 * @returns 包含参数占位符时返回 true。
 */
export function hasPromptArguments(body: string): boolean {
  return body.includes(PROMPT_ARGUMENTS_TOKEN)
}

/**
 * 将提示模板正文按 `$ARGUMENTS` 拆分为普通文本与参数片段，用于安全高亮展示。
 * @param body 模板正文。
 * @returns 按原文顺序排列的片段数组。
 */
export function splitPromptArguments(body: string): PromptTemplateSegment[] {
  if (!body) return []
  const parts = body.split(PROMPT_ARGUMENTS_TOKEN)
  const segments: PromptTemplateSegment[] = []
  parts.forEach((part, index) => {
    if (part) segments.push({ text: part, isArgument: false })
    if (index < parts.length - 1) segments.push({ text: PROMPT_ARGUMENTS_TOKEN, isArgument: true })
  })
  return segments
}

/**
 * 将模板中的 `$ARGUMENTS` 替换为测试参数，用于右侧实时试填预览。
 * @param body 模板正文。
 * @param value 成员输入的测试参数。
 * @returns 替换后的完整提示词文本。
 */
export function renderPromptWithArguments(body: string, value: string): string {
  const replacement = value.trim() || '[待填写参数]'
  return body.split(PROMPT_ARGUMENTS_TOKEN).join(replacement)
}

/**
 * 校验提示模板命令名称是否符合平台规则（小写字母、数字与短横线）。
 * @param name 去除空白后的命令名称。
 * @returns 合法时返回 true。
 */
export function isValidPromptTemplateName(name: string): boolean {
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)
}

/**
 * 为「派生新模板」生成不与原命令重名的初始建议名称。
 * @param baseName 原模板命令名称。
 * @returns 截取在 40 字符以内的建议名称。
 */
export function suggestForkedTemplateName(baseName: string): string {
  const suffix = '-copy'
  const prefix = baseName.slice(0, 40 - suffix.length).replace(/-+$/u, '')
  return `${prefix || 'template'}${suffix}`
}
