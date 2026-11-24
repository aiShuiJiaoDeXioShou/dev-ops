import { Fragment, memo, useDeferredValue, useEffect, useRef, useState, type CSSProperties } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import rehypeSanitize from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import { Copy } from 'lucide-react'
import { Button } from '@/shared/ui/controls/button'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/shared/ui/controls/table'
import { useToast } from '@/shared/ui/toast'
import type { highlightConversationCode } from '../model/conversation-highlight'
import { splitStreamingMarkdown } from '../model/incremental-markdown'
import './conversation-content.css'

type HighlightedLines = Awaited<ReturnType<typeof highlightConversationCode>>
type SyntaxColors = CSSProperties & { '--code-light'?: string; '--code-dark'?: string }

const MAX_HIGHLIGHT_LENGTH = 32_000

function ReplyCode({ language, source }: { language?: string; source: string }) {
  const { showToast } = useToast()
  const code = useRef<HTMLPreElement>(null)
  const deferredSource = useDeferredValue(source)
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined')
  const [highlight, setHighlight] = useState<{ source: string; language: string; lines: HighlightedLines }>()

  useEffect(() => {
    const element = code.current
    if (!element || visible || !language) return
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some(({ isIntersecting }) => isIntersecting)) return
      setVisible(true)
      observer.disconnect()
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [language, visible])

  useEffect(() => {
    if (!language || !visible || deferredSource.length > MAX_HIGHLIGHT_LENGTH) return
    let cancelled = false
    void import('../model/conversation-highlight')
      .then(({ highlightConversationCode }) => highlightConversationCode(deferredSource, language))
      .then(
        (lines) => {
          if (!cancelled) setHighlight({ source: deferredSource, language, lines })
        },
        () => {
          // 高亮加载失败时保持原文可读且可复制。
          if (!cancelled) setHighlight(undefined)
        },
      )
    return () => {
      cancelled = true
    }
  }, [deferredSource, language, visible])

  async function copy() {
    try {
      await navigator.clipboard.writeText(source)
      showToast('已复制代码', 'success')
    } catch {
      showToast('复制失败，请检查浏览器剪贴板权限。', 'error')
    }
  }

  const lines = highlight?.language === language && highlight?.source === source ? highlight?.lines : undefined
  return (
    <div className="conversation-code">
      <div className="conversation-code-bar">
        <span>{language || '纯文本'}</span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          title="复制代码"
          aria-label="复制代码"
          onClick={() => void copy()}
        >
          <Copy />
        </Button>
      </div>
      <pre ref={code} tabIndex={0} className="conversation-code-body">
        <code>
          {lines
            ? lines.map((line, index) => (
                <Fragment key={index}>
                  {line.map(({ offset, content, variants }) => {
                    const style: SyntaxColors = {
                      '--code-light': variants.light?.color,
                      '--code-dark': variants.dark?.color,
                    }
                    return (
                      <span className="conversation-code-token" key={offset} style={style}>
                        {content}
                      </span>
                    )
                  })}
                  {index < lines.length - 1 && '\n'}
                </Fragment>
              ))
            : source}
        </code>
      </pre>
    </div>
  )
}

const markdownComponents: Components = {
  table: ({ children }) => (
    <Table className="w-max" containerProps={{ tabIndex: 0, role: 'region', 'aria-label': '回复表格' }}>
      {children}
    </Table>
  ),
  thead: ({ children }) => <TableHeader>{children}</TableHeader>,
  tbody: ({ children }) => <TableBody>{children}</TableBody>,
  tr: ({ children }) => <TableRow className="border-0 hover:bg-transparent">{children}</TableRow>,
  th: ({ children, style }) => (
    <TableHead scope="col" style={style} className="h-auto whitespace-normal px-3 py-2">
      {children}
    </TableHead>
  ),
  td: ({ children, style }) => (
    <TableCell style={style} className="px-3 py-2">
      {children}
    </TableCell>
  ),
  pre: ({ node, children }) => {
    const code = node?.children[0]
    if (code?.type !== 'element' || code.tagName !== 'code') return <pre>{children}</pre>
    const classes = code.properties.className
    const language = Array.isArray(classes)
      ? classes.find((item): item is string => typeof item === 'string' && item.startsWith('language-'))?.slice(9)
      : undefined
    const source = code.children.flatMap((child) => (child.type === 'text' ? [child.value] : [])).join('')
    return <ReplyCode language={language} source={source} />
  },
}

const MarkdownPart = memo(function MarkdownPart({ source, withMath }: { source: string; withMath: boolean }) {
  const [math, setMath] = useState<typeof import('./conversation-math')>()
  const hasMath = withMath && source.lastIndexOf('$') > source.indexOf('$')
  useEffect(() => {
    if (!hasMath || math) return
    let cancelled = false
    void import('./conversation-math').then(
      (renderer) => {
        if (!cancelled) setMath(renderer)
      },
      () => {
        // 公式渲染器加载失败时仍显示原始 Markdown。
        if (!cancelled) setMath(undefined)
      },
    )
    return () => {
      cancelled = true
    }
  }, [hasMath, math])

  return (
    <ReactMarkdown
      remarkPlugins={
        math && hasMath ? [[remarkGfm, { singleTilde: false }], math.remarkMath] : [[remarkGfm, { singleTilde: false }]]
      }
      rehypePlugins={
        math && hasMath
          ? [rehypeSanitize, [math.rehypeKatex, { trust: false, maxExpand: 100, maxSize: 20 }]]
          : [rehypeSanitize]
      }
      components={markdownComponents}
    >
      {source}
    </ReactMarkdown>
  )
})

/**
 * 渲染 Bot 的工作草稿和正式回答，冻结流式输出的稳定块，正式提交后解析完整文档。
 * @param props 回复源文本、流式状态和工作过程的紧凑排版。
 * @returns 经清理的 Markdown。公式在正式正文中渲染，代码进入视口后才加载高亮。
 */
export function ConversationMarkdown({
  text,
  running,
  compact = false,
}: {
  text: string
  running: boolean
  compact?: boolean
}) {
  const value = text
  const [stream, setStream] = useState(() => (running ? splitStreamingMarkdown(value) : undefined))
  const parts = running ? splitStreamingMarkdown(value, stream) : undefined
  if (running && parts !== stream) setStream(parts)

  return (
    <div className="md-body dsh-markdown" data-compact={compact || undefined}>
      {parts ? (
        <>
          {parts.frozen.map(({ offset, source }) => (
            <MarkdownPart key={offset} source={source} withMath={false} />
          ))}
          <MarkdownPart key={parts.tail.offset} source={parts.tail.source} withMath={false} />
        </>
      ) : (
        <MarkdownPart source={value} withMath={!compact} />
      )}
    </div>
  )
}
