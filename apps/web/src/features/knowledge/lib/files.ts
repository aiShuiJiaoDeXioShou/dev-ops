/**
 * 复制文本到剪贴板；浏览器拒绝时返回 false，由调用方提供手动复制。
 * @param text 待复制文本。
 * @returns 是否复制成功。
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/**
 * 触发浏览器下载纯文本文件。
 * @param filename 下载文件名。
 * @param content 文件内容。
 */
export function downloadTextFile(filename: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** 拼接技能 SKILL.md 展示与下载内容。 */
export function skillMarkdown(name: string, content: string): string {
  return `# ${name}\n\n${content}`
}
