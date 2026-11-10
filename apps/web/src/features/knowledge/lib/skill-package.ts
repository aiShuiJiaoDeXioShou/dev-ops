import type { ImportedSkillPackage, SkillFileDraft } from '../model/types'
import { createZip } from './zip'

/** 资源文件上限，与服务端校验保持一致；客户端先提示再提交。 */
export const SKILL_FILE_LIMITS = {
  maxCount: 50,
  textMaxLength: 120_000,
  binaryMaxBytes: 200 * 1024,
  totalMaxBytes: 400 * 1024,
} as const

/** 前端可直接编辑的文本扩展名；其他文件按二进制处理并仅允许下载。 */
const TEXT_EXTENSIONS = new Set([
  'md',
  'mdx',
  'txt',
  'json',
  'yaml',
  'yml',
  'toml',
  'ini',
  'sh',
  'bash',
  'zsh',
  'py',
  'js',
  'mjs',
  'cjs',
  'ts',
  'tsx',
  'jsx',
  'css',
  'html',
  'sql',
  'go',
  'rs',
  'java',
  'rb',
  'php',
  'c',
  'h',
  'cpp',
  'csv',
  'xml',
])

/**
 * 判断资源文件是否按 UTF-8 文本编辑。
 * @param path 相对路径。
 * @param content 文件内容。
 * @param encoding 存储编码。
 * @returns 是否可在界面中直接编辑。
 */
export function isEditableSkillFile(path: string, content: string, encoding: 'utf8' | 'base64'): boolean {
  if (encoding !== 'utf8') return false
  const extension = path.split('.').pop()?.toLowerCase() ?? ''
  return TEXT_EXTENSIONS.has(extension) && content.length > 0
}

/** 生成社区格式的 SKILL.md 内容：YAML frontmatter + Markdown 正文。 */
export function generateSkillMarkdown(identifier: string, summary: string, content: string): string {
  return `---\nname: ${identifier}\ndescription: ${JSON.stringify(summary)}\n---\n\n${content}\n`
}

/** 从 SKILL.md 文本中提取简单 frontmatter 的 name/description 与正文。 */
export function splitSkillFrontmatter(markdown: string): {
  name: string | null
  description: string | null
  body: string
} {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(markdown)
  if (!match) return { name: null, description: null, body: markdown }
  const yaml = match[1] ?? ''
  const readField = (key: string): string | null => {
    const field = new RegExp(`^${key}:\\s*(.+?)\\s*$`, 'm').exec(yaml)
    if (!field) return null
    const raw = field[1] ?? ''
    const unquoted = /^"(.*)"$/.exec(raw) ?? /^'(.*)'$/.exec(raw)
    return (unquoted?.[1] ?? raw).trim() || null
  }
  return {
    name: readField('name'),
    description: readField('description'),
    body: markdown.slice(match[0].length).replace(/^\n+/, ''),
  }
}

/** 计算 base64 文本的字节长度。 */
function decodedBase64Bytes(content: string): number {
  const normalized = content.replace(/\s+/g, '')
  return Math.floor((normalized.length * 3) / 4) - (normalized.endsWith('==') ? 2 : normalized.endsWith('=') ? 1 : 0)
}

/** 计算草稿文件大小，用于界面展示与上限提示。 */
export function skillFileSize(file: { content: string; encoding: 'utf8' | 'base64' }): number {
  return file.encoding === 'base64' ? decodedBase64Bytes(file.content) : new TextEncoder().encode(file.content).length
}

/** 以可读单位展示文件大小。 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** 二进制字节转 base64；分块避免超长参数栈溢出。 */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }
  return btoa(binary)
}

/** base64 文本转二进制。 */
export function base64ToBytes(content: string): Uint8Array {
  const binary = atob(content.replace(/\s+/g, ''))
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

/**
 * 解析目录导入的 Skill 文件包：识别根目录 SKILL.md 与 scripts/references/assets 等资源。
 * @param fileList 浏览器目录选择得到的文件列表。
 * @returns frontmatter 元数据、正文与资源文件草稿。
 * @throws 文件数量或大小超限、SKILL.md 缺失时抛出可展示的错误。
 */
export async function readSkillPackageDirectory(fileList: FileList | File[]): Promise<ImportedSkillPackage> {
  const selected = Array.from(fileList).filter((file) => file.name !== '.DS_Store')
  if (selected.length === 0) throw new Error('目录中没有可导入的文件。')
  if (selected.length > SKILL_LIMITS_FILES) throw new Error('技能最多包含 50 个文件。')
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const files: SkillFileDraft[] = []
  let frontmatterName: string | null = null
  let summary: string | null = null
  let body: string | null = null
  let totalBytes = 0
  for (const file of selected) {
    const withPath = file as File & { webkitRelativePath?: string }
    const segments = (withPath.webkitRelativePath || file.name).split('/').filter(Boolean)
    const relativePath = segments.length > 1 ? segments.slice(1).join('/') : segments.join('/')
    if (!relativePath) continue
    const buffer = await file.arrayBuffer()
    if (relativePath.toLowerCase() === 'skill.md') {
      const text = decoder.decode(buffer)
      const parsed = splitSkillFrontmatter(text)
      frontmatterName = parsed.name
      summary = parsed.description
      body = parsed.body
      continue
    }
    if (file.size > SKILL_FILE_LIMITS.binaryMaxBytes) {
      throw new Error(`文件 ${relativePath} 超过 ${formatFileSize(SKILL_FILE_LIMITS.binaryMaxBytes)} 上限。`)
    }
    totalBytes += buffer.byteLength
    if (totalBytes > SKILL_FILE_LIMITS.totalMaxBytes) {
      throw new Error(`资源文件总大小超过 ${formatFileSize(SKILL_FILE_LIMITS.totalMaxBytes)} 上限。`)
    }
    let content: string
    let encoding: 'utf8' | 'base64'
    try {
      content = decoder.decode(buffer)
      if (content.length > SKILL_FILE_LIMITS.textMaxLength) {
        throw new Error(`文件 ${relativePath} 超过文本长度上限。`)
      }
      encoding = 'utf8'
    } catch {
      content = bytesToBase64(new Uint8Array(buffer))
      encoding = 'base64'
    }
    files.push({ path: relativePath, content, encoding })
  }
  if (body === null) throw new Error('技能包根目录必须包含 SKILL.md。')
  return { frontmatterName, summary, body, files }
}

/** 目录导入允许的最大文件数，独立常量避免重复。 */
const SKILL_LIMITS_FILES = 50

/**
 * 生成技能包 ZIP：SKILL.md（含自动 frontmatter）与全部资源文件。
 * @param skill 技能标识、简述与正文。
 * @param files 资源文件。
 * @returns 可下载的 ZIP。
 */
export function createSkillPackageZip(
  skill: { identifier: string; summary: string; content: string },
  files: SkillFileDraft[],
): Blob {
  return createZip([
    { path: 'SKILL.md', content: generateSkillMarkdown(skill.identifier, skill.summary, skill.content) },
    ...files.map((file) => ({
      path: file.path,
      content: file.encoding === 'base64' ? base64ToBytes(file.content) : file.content,
    })),
  ])
}

/** 触发浏览器下载。 */
export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** 将字节数组复制为独立 ArrayBuffer 后生成 Blob，避免跨视图类型问题。 */
export function blobFromBytes(bytes: Uint8Array, type = 'application/octet-stream'): Blob {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return new Blob([copy.buffer], { type })
}

/** 打开目录选择器并读取技能包；由调用方处理取消（返回 null）。 */
export function pickSkillDirectory(): Promise<FileList | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    input.setAttribute('webkitdirectory', '')
    input.setAttribute('directory', '')
    input.addEventListener('change', () => resolve(input.files), { once: true })
    input.click()
  })
}
