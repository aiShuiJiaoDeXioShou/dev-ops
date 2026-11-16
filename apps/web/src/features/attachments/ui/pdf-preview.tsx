import { useEffect, useRef, useState } from 'react'
import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
  type RenderTask,
} from 'pdfjs-dist/legacy/build/pdf.mjs'
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import { Button } from '@/shared/ui/controls/button'

GlobalWorkerOptions.workerSrc = workerUrl

const MAX_PAGE_PIXELS = 1600

function PdfPages({ pdf }: { pdf: PDFDocumentProxy }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [pageNumber, setPageNumber] = useState(1)
  const [renderedPage, setRenderedPage] = useState<number | null>(null)
  const [failedPage, setFailedPage] = useState<number | null>(null)
  useEffect(() => {
    const surface = canvas.current
    if (!surface) return
    let active = true
    let render: RenderTask | undefined
    void (async () => {
      const page = await pdf.getPage(pageNumber)
      if (!active) return
      const base = page.getViewport({ scale: 1 })
      const scale = Math.min(2, MAX_PAGE_PIXELS / Math.max(base.width, base.height))
      const viewport = page.getViewport({ scale })
      surface.width = Math.ceil(viewport.width)
      surface.height = Math.ceil(viewport.height)
      render = page.render({ canvas: surface, viewport })
      await render.promise
      if (active) setRenderedPage(pageNumber)
    })().catch(() => {
      if (active) setFailedPage(pageNumber)
    })
    return () => {
      active = false
      render?.cancel()
    }
  }, [pdf, pageNumber])
  return (
    <div className="space-y-3">
      {pdf.numPages > 1 && (
        <div className="sticky top-0 flex items-center justify-center gap-3 rounded-lg border border-border bg-background p-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pageNumber <= 1}
            onClick={() => setPageNumber(pageNumber - 1)}
          >
            上一页
          </Button>
          <span aria-live="polite">
            {pageNumber} / {pdf.numPages}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pageNumber >= pdf.numPages}
            onClick={() => setPageNumber(pageNumber + 1)}
          >
            下一页
          </Button>
        </div>
      )}
      {failedPage === pageNumber ? (
        <p role="alert">这一页无法预览，请下载后查看。</p>
      ) : (
        renderedPage !== pageNumber && <p role="status">正在渲染 PDF…</p>
      )}
      <canvas
        ref={canvas}
        role="img"
        aria-label={`PDF 第 ${pageNumber} 页`}
        hidden={renderedPage !== pageNumber}
        className="mx-auto max-w-full"
      />
    </div>
  )
}

/**
 * 在同源 PDF.js Worker 内按页渲染文档，关闭时释放文档与绘制任务。
 * @param props 经过附件下载鉴权的文件内容。
 * @returns PDF 分页预览、加载反馈或下载提示。
 */
export default function PdfPreview({ blob }: { blob: Blob }) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let active = true
    let loading: PDFDocumentLoadingTask | undefined
    void (async () => {
      const bytes = await blob.arrayBuffer()
      if (!active) return
      loading = getDocument({ data: new Uint8Array(bytes), enableXfa: false, maxImageSize: 16_000_000 })
      const document = await loading.promise
      if (active) setPdf(document)
    })().catch(() => {
      if (active) setFailed(true)
    })
    return () => {
      active = false
      void loading?.destroy().catch((error: unknown) => console.warn('释放 PDF 预览失败', error))
    }
  }, [blob])

  if (failed) return <p role="alert">PDF 无法预览，请下载后查看。</p>
  return pdf ? <PdfPages pdf={pdf} /> : <p role="status">正在读取 PDF…</p>
}
