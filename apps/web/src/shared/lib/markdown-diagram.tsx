import { useEffect, useId, useState } from 'react'

/**
 * 按需加载 Mermaid 并以严格安全模式渲染图表。
 * @param props source 为 Mermaid 源文本；超过 50000 字符时只展示源码。
 * @returns 图表、加载提示或失败时的原文；卸载后忽略异步结果。
 */
export function MarkdownDiagram({ source }: { source: string }) {
  const id = useId().replace(/[^a-z\d]/gi, '')
  const [result, setResult] = useState<{ source: string; svg?: string; failed?: boolean }>()
  useEffect(() => {
    if (source.length > 50_000) return
    let cancelled = false
    void import('mermaid')
      .then(async ({ default: mermaid }) => {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          suppressErrorRendering: true,
          maxTextSize: 50_000,
        })
        const { svg } = await mermaid.render(`markdown-${id}`, source)
        if (!cancelled) setResult({ source, svg })
      })
      .catch(() => {
        if (!cancelled) setResult({ source, failed: true })
      })
    return () => {
      cancelled = true
    }
  }, [source, id])
  const current = result?.source === source ? result : undefined
  if (current?.svg) return <div className="markdown-diagram" dangerouslySetInnerHTML={{ __html: current.svg }} />
  return (
    <div>
      <p role="status">{current?.failed || source.length > 50_000 ? '图表无法渲染，显示源码。' : '图表加载中…'}</p>
      <pre>
        <code>{source}</code>
      </pre>
    </div>
  )
}
