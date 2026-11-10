import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import css from 'highlight.js/lib/languages/css'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import markdown from 'highlight.js/lib/languages/markdown'
import python from 'highlight.js/lib/languages/python'
import sql from 'highlight.js/lib/languages/sql'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'

const registered = new Set<string>()

function register(name: string, language: Parameters<typeof hljs.registerLanguage>[1]) {
  if (registered.has(name)) return
  hljs.registerLanguage(name, language)
  registered.add(name)
}

register('bash', bash)
register('css', css)
register('javascript', javascript)
register('json', json)
register('markdown', markdown)
register('python', python)
register('sql', sql)
register('typescript', typescript)
register('xml', xml)
register('yaml', yaml)

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  bash: 'bash',
  css: 'css',
  go: 'go',
  html: 'xml',
  js: 'javascript',
  json: 'json',
  jsx: 'javascript',
  md: 'markdown',
  mdx: 'markdown',
  py: 'python',
  sh: 'bash',
  sql: 'sql',
  ts: 'typescript',
  tsx: 'typescript',
  yml: 'yaml',
  yaml: 'yaml',
}

/**
 * 根据文件路径推断 highlight.js 语言。
 * @param path 文件路径。
 * @returns 已注册语言名；未知类型返回 null。
 */
export function languageForPath(path: string): string | null {
  const extension = path.split('.').at(-1)?.toLowerCase() ?? ''
  const language = LANGUAGE_BY_EXTENSION[extension]
  return language && registered.has(language) ? language : null
}

/**
 * 使用 highlight.js 生成安全的代码高亮 HTML。
 * @param content 文件文本。
 * @param path 文件路径，用于推断语言。
 * @returns 转义后的高亮 HTML；未知语言返回纯文本转义结果。
 */
export function highlightCode(content: string, path: string): string {
  const language = languageForPath(path)
  if (!language) return hljs.highlightAuto(content).value
  return hljs.highlight(content, { language, ignoreIllegals: true }).value
}
