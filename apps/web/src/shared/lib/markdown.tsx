import { Children, cloneElement, isValidElement, type ReactNode } from 'react'
import ReactMarkdown, { defaultUrlTransform, type Components } from 'react-markdown'
import rehypeRaw from 'rehype-raw'
import rehypeSlug from 'rehype-slug'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkEmoji from 'remark-emoji'
import { Table } from '@/shared/ui/controls/table'
import { Checkbox } from '@/shared/ui/controls/checkbox'
import { MarkdownDiagram } from './markdown-diagram'
import { highlightCode } from './highlight'
import 'katex/dist/katex.min.css'
import './markdown.css'

const schema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [...(defaultSchema.attributes?.code ?? []), ['className', /^language-./, 'math-inline', 'math-display']],
  },
}

const components: Components = {
  blockquote: ({ node: _node, children, ...props }) => {
    const blocks = Children.toArray(children)
    const index = blocks.findIndex((block) => isValidElement(block))
    const paragraph = blocks[index]
    if (isValidElement<{ children?: ReactNode }>(paragraph)) {
      const content = Children.toArray(paragraph.props.children)
      const first = content[0]
      const match = typeof first === 'string' ? /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:\n|$)/.exec(first) : null
      if (match && typeof first === 'string') {
        content[0] = first.slice(match[0].length)
        blocks[index] = cloneElement(paragraph, undefined, ...content)
        return (
          <blockquote {...props} className="markdown-alert" data-alert={match[1]}>
            <strong>{match[1]}</strong>
            {blocks}
          </blockquote>
        )
      }
    }
    return <blockquote {...props}>{children}</blockquote>
  },
  a: ({ node: _node, href, ...props }) => (
    <a
      {...props}
      href={href?.startsWith('#') && !href.startsWith('#user-content-') ? `#user-content-${href.slice(1)}` : href}
      target={href?.startsWith('#') ? undefined : '_blank'}
      rel="noreferrer noopener"
    />
  ),
  img: ({ node: _node, ...props }) => <img {...props} alt={props.alt ?? ''} loading="lazy" />,
  table: ({ node: _node, ...props }) => <Table {...props} />,
  input: ({ checked }) => <Checkbox checked={checked} disabled aria-label={checked ? '已完成' : '未完成'} />,
  pre: ({ children, node: _node, ...props }) => {
    const child = Children.toArray(children)[0]
    if (
      isValidElement<{ className?: string; children?: string }>(child) &&
      child.props.className === 'language-mermaid'
    ) {
      return <MarkdownDiagram source={String(child.props.children ?? '')} />
    }
    return <pre {...props}>{children}</pre>
  },
  code: ({ node: _node, className, children, ...props }) => {
    const language = /language-(\S+)/.exec(className ?? '')?.[1]
    if (!language || language === 'mermaid')
      return (
        <code {...props} className={className}>
          {children}
        </code>
      )
    // 高亮器转义源码后生成标记，远端 HTML 不能直接进入此处。
    return (
      <code
        {...props}
        className={className}
        dangerouslySetInnerHTML={{ __html: highlightCode(String(children), `code.${language}`) }}
      />
    )
  },
}

/**
 * 渲染 GitHub 风格 Markdown，先解析 HTML 再清洗，公式只在清洗后由可信插件生成。
 * @param props children 为不受信任的文档；resolveUrl 可把安全相对地址映射为仓库资源。
 * @returns 包含 GFM、折叠区、锚点和数学公式的正文；脚本与事件属性不会保留。
 */
export function Markdown({
  children,
  resolveUrl,
}: {
  children: string
  resolveUrl?: (url: string, kind: 'image' | 'link') => string
}) {
  return (
    <div className="md-body github-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath, remarkEmoji]}
        rehypePlugins={[
          rehypeRaw,
          rehypeSlug,
          [rehypeSanitize, schema],
          [rehypeKatex, { trust: false, maxExpand: 100, maxSize: 20 }],
        ]}
        components={components}
        urlTransform={(url, key) => {
          const safe = defaultUrlTransform(url)
          return safe && resolveUrl ? defaultUrlTransform(resolveUrl(safe, key === 'src' ? 'image' : 'link')) : safe
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}
