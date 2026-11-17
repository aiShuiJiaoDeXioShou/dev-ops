import { containsCredential } from '@dev-ops/devops-bot'

/**
 * 将可能含凭据的聊天内容替换为固定说明。
 * @param text 用户或模型输出的原文。
 * @returns 可落库的文本，不返回发现的凭据。
 */
export function redactChatContent(text: string): string {
  return containsCredential(text) ? '[内容含疑似凭据，已隐藏]' : text
}

/**
 * 检测任务结果等必须拒绝落库的正文是否含凭据样式。
 * @param text 用户或模型提交的正文。
 * @returns 是否匹配凭据检测规则。
 */
export function hasChatCredential(text: string): boolean {
  return containsCredential(text)
}
