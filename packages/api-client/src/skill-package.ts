import { createZip } from './skill-zip.ts'

/**
 * 生成带 YAML frontmatter 的 SKILL.md。
 * @param identifier 技能标识。
 * @param summary 技能简述，按 JSON 字符串转义后可用作 YAML 标量。
 * @param content 技能正文。
 * @returns 完整 Markdown 文本。
 */
export function generateSkillMarkdown(identifier: string, summary: string, content: string): string {
  return `---\nname: ${identifier}\ndescription: ${JSON.stringify(summary)}\n---\n\n${content}\n`
}

/**
 * 解码技能资源文件的 base64 文本。
 * @param content 服务端已校验的编码文本，允许空白字符。
 * @returns 解码后的原始字节；编码无效时抛出异常。
 */
export function base64ToBytes(content: string): Uint8Array {
  const binary = atob(content.replace(/\s+/g, ''))
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

/**
 * 生成技能包 ZIP：SKILL.md（含自动 frontmatter）与全部资源文件。
 * @param skill 技能标识、简述与正文。
 * @param files 资源文件。
 * @returns 可下载的 ZIP。
 */
export function createSkillPackageZip(
  skill: { identifier: string; summary: string; content: string },
  files: Array<{ path: string; content: string; encoding: 'utf8' | 'base64' }>,
): Blob {
  return createZip([
    { path: 'SKILL.md', content: generateSkillMarkdown(skill.identifier, skill.summary, skill.content) },
    ...files.map((file) => ({
      path: file.path,
      content: file.encoding === 'base64' ? base64ToBytes(file.content) : file.content,
    })),
  ])
}
