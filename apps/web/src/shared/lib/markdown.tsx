import ReactMarkdown, { type Components } from 'react-markdown'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'

const schema = {
  ...defaultSchema,
  protocols: {
    ...(defaultSchema.protocols ?? {}),
    href: ['http', 'https', 'mailto'],
  },
}

const components: Components = {
  a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer noopener" />,
  img: ({ node: _node, ...props }) => <img {...props} alt={props.alt ?? ''} />,
}

/** 仅允许安全协议的链接，避免 Markdown 注入 javascript: 等地址。 */
function safeUrl(url: string): string {
  const trimmed = url.trim().toLowerCase()
  if (
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('mailto:') ||
    trimmed.startsWith('#') ||
    trimmed.startsWith('/')
  )
    return url
  return ''
}

/**
 * 渲染受信任的 Markdown 源文本，HTML 通过 sanitize 白名单过滤。
 * @param props children 为 Markdown 源文本；不接受 HTML 字符串直接注入。
 * @returns 安全渲染的 React 节点。
 */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="md-body">
      <ReactMarkdown rehypePlugins={[[rehypeSanitize, schema]]} components={components} urlTransform={safeUrl}>
        {children}
      </ReactMarkdown>
    </div>
  )
}
