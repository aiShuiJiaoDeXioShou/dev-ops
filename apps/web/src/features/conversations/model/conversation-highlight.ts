import { createHighlighterCore } from 'shiki/core'
import { createOnigurumaEngine } from 'shiki/engine/oniguruma'

const grammars = {
  css: () => import('shiki/langs/css.mjs'),
  diff: () => import('shiki/langs/diff.mjs'),
  dockerfile: () => import('shiki/langs/dockerfile.mjs'),
  go: () => import('shiki/langs/go.mjs'),
  html: () => import('shiki/langs/html.mjs'),
  java: () => import('shiki/langs/java.mjs'),
  javascript: () => import('shiki/langs/javascript.mjs'),
  json: () => import('shiki/langs/json.mjs'),
  jsx: () => import('shiki/langs/jsx.mjs'),
  markdown: () => import('shiki/langs/markdown.mjs'),
  powershell: () => import('shiki/langs/powershell.mjs'),
  python: () => import('shiki/langs/python.mjs'),
  rust: () => import('shiki/langs/rust.mjs'),
  shellscript: () => import('shiki/langs/shellscript.mjs'),
  sql: () => import('shiki/langs/sql.mjs'),
  tsx: () => import('shiki/langs/tsx.mjs'),
  typescript: () => import('shiki/langs/typescript.mjs'),
  xml: () => import('shiki/langs/xml.mjs'),
  yaml: () => import('shiki/langs/yaml.mjs'),
}
type Grammar = keyof typeof grammars
const aliases: Partial<Record<string, Grammar>> = {
  bash: 'shellscript',
  js: 'javascript',
  md: 'markdown',
  ps1: 'powershell',
  py: 'python',
  sh: 'shellscript',
  ts: 'typescript',
  yml: 'yaml',
  zsh: 'shellscript',
}

const themes = { light: 'github-light', dark: 'github-dark' }
let highlighter: ReturnType<typeof createHighlighterCore> | undefined

function isGrammar(language: string): language is Grammar {
  return Object.hasOwn(grammars, language)
}

/**
 * 使用 DSH 同款 Shiki 高亮，按语言延迟加载语法，并返回两套主题的安全文本标记。
 * @param source 原始代码。
 * @param language 围栏中的语言标记。
 * @returns 双主题标记，未知语言返回 undefined；加载失败向上传递，由界面退回纯文本。
 */
export async function highlightConversationCode(source: string, language: string) {
  const normalized = language.toLowerCase()
  const grammar = aliases[normalized] ?? normalized
  if (!isGrammar(grammar)) return undefined
  highlighter ??= createHighlighterCore({
    themes: [import('shiki/themes/github-light.mjs'), import('shiki/themes/github-dark.mjs')],
    langs: [],
    engine: createOnigurumaEngine(import('shiki/wasm')),
  }).catch((error: unknown) => {
    highlighter = undefined
    throw error
  })
  const syntax = await highlighter
  if (!syntax.getLoadedLanguages().includes(grammar)) {
    await syntax.loadLanguage(await grammars[grammar]())
  }
  return syntax.codeToTokensWithThemes(source, { lang: grammar, themes })
}
