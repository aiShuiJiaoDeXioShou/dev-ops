import { useRef, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeSanitize from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import { Copy } from 'lucide-react'
import { Button } from '@/shared/ui/controls/button'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/shared/ui/controls/table'
import { useToast } from '@/shared/ui/toast'
import './conversation-content.css'

function ReplyCode({ language, children }: { language?: string; children: ReactNode }) {
  const { showToast } = useToast()
  const code = useRef<HTMLPreElement>(null)

  async function copy() {
    if (!code.current) return
    try {
      await navigator.clipboard.writeText(code.current.textContent ?? '')
      showToast('已复制代码', 'success')
    } catch {
      showToast('复制失败，请检查浏览器剪贴板权限。', 'error')
    }
  }

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
        {children}
      </pre>
    </div>
  )
}

/**
 * 渲染 Bot 的增量及最终 Markdown，保留列表层级、代码和宽表格的阅读结构。
 * @param props 回复源文本及是否仍在生成。
 * @returns 经清理的 Markdown 正文，正在生成时在末段补光标。
 */
export function ConversationMarkdown({ text, running }: { text: string; running: boolean }) {
  const value = text.trimEnd()
  return (
    <div className="md-body dsh-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={{
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
          pre: ({ children, node }) => {
            const code = node?.children[0]
            const classes = code?.type === 'element' ? code.properties.className : undefined
            const language = Array.isArray(classes)
              ? classes
                  .find((item): item is string => typeof item === 'string' && item.startsWith('language-'))
                  ?.slice(9)
              : undefined
            return <ReplyCode language={language}>{children}</ReplyCode>
          },
          p: ({ children, node }) => (
            <p>
              {children}
              {running && node?.position?.end.offset === value.length && (
                <span className="dsh-cursor" aria-hidden="true" />
              )}
            </p>
          ),
        }}
      >
        {value}
      </ReactMarkdown>
    </div>
  )
}
