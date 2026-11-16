import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/shared/ui/controls/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/shared/ui/controls/dialog'
import { attachmentDownloadPath, fetchAttachmentBlob } from '../api/attachments-api'
import { describeAttachmentError } from '../lib/errors'
import type { AttachmentSummary } from '../model/types'

const PdfPreview = lazy(() => import('./pdf-preview'))
const TEXT_PREVIEW_BYTES = 128 * 1024

const IMAGE_TYPES = new Map([
  ['png', 'image/png'],
  ['jpg', 'image/jpeg'],
  ['jpeg', 'image/jpeg'],
  ['gif', 'image/gif'],
  ['webp', 'image/webp'],
  ['avif', 'image/avif'],
  ['bmp', 'image/bmp'],
])
const IMAGE_MIMES = new Set(IMAGE_TYPES.values())
const TEXT_EXTENSIONS = new Set(['txt', 'log', 'md', 'csv', 'tsv', 'json', 'xml', 'yml', 'yaml'])

type PreviewFile = Pick<AttachmentSummary, 'id' | 'fileName' | 'contentType'>
type PreviewFormat = { kind: 'image'; mime: string } | { kind: 'pdf' } | { kind: 'text' }

function previewFormat({ fileName, contentType }: PreviewFile): PreviewFormat | null {
  const mime = contentType?.split(';')[0]?.trim().toLowerCase()
  if (mime === 'application/pdf') return { kind: 'pdf' }
  if (mime && IMAGE_MIMES.has(mime)) return { kind: 'image', mime }
  if (mime?.startsWith('text/') || mime === 'application/json' || mime === 'application/xml') return { kind: 'text' }
  const extension = fileName.split('.').at(-1)?.toLowerCase() ?? ''
  if (extension === 'pdf') return { kind: 'pdf' }
  const imageMime = IMAGE_TYPES.get(extension)
  if (imageMime) return { kind: 'image', mime: imageMime }
  if (TEXT_EXTENSIONS.has(extension)) return { kind: 'text' }
  return null
}

function ImagePreview({ blob, mime, fileName }: { blob: Blob; mime: string; fileName: string }) {
  const image = useRef<HTMLImageElement>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (!image.current) return
    const url = URL.createObjectURL(blob.slice(0, blob.size, mime))
    image.current.src = url
    return () => URL.revokeObjectURL(url)
  }, [blob, mime])
  if (failed) return <p role="alert">图片无法预览，请下载后查看。</p>
  return <img ref={image} alt={fileName} className="mx-auto block h-auto max-w-full" onError={() => setFailed(true)} />
}

function PreviewBody({ file, format }: { file: PreviewFile; format: PreviewFormat }) {
  const query = useQuery({
    queryKey: ['attachments', 'preview', file.id],
    gcTime: 0,
    retry: false,
    queryFn: async ({ signal }) => {
      const blob = await fetchAttachmentBlob(file.id, signal)
      if (format.kind === 'text') {
        return {
          kind: 'text' as const,
          text: await blob.slice(0, TEXT_PREVIEW_BYTES).text(),
          truncated: blob.size > TEXT_PREVIEW_BYTES,
        }
      }
      return { ...format, blob }
    },
  })
  if (query.isPending) return <p role="status">正在加载预览…</p>
  if (query.isError) {
    return (
      <div className="space-y-3">
        <p role="alert" className="text-destructive">
          {describeAttachmentError(query.error)}
        </p>
        <Button type="button" variant="outline" size="sm" onClick={() => void query.refetch()}>
          重试
        </Button>
      </div>
    )
  }
  const preview = query.data
  if (preview.kind === 'image') return <ImagePreview blob={preview.blob} mime={preview.mime} fileName={file.fileName} />
  if (preview.kind === 'pdf') {
    return (
      <Suspense fallback={<p role="status">正在加载 PDF 预览…</p>}>
        <PdfPreview blob={preview.blob} />
      </Suspense>
    )
  }
  return (
    <>
      {/* 附件文字保持纯文本，避免把上传内容当成页面标记。 */}
      <pre className="font-mono text-sm wrap-anywhere whitespace-pre-wrap">{preview.text}</pre>
      {preview.truncated && <p className="mt-3 text-muted-foreground">仅显示文件开头，完整内容可下载查看。</p>}
    </>
  )
}

/**
 * 为支持的图片、PDF 和文本附件提供预览入口，打开后按需读取内容。
 * @param props 附件标识、显示文件名及上传时记录的类型。
 * @returns 可预览附件的按钮和弹窗，其他格式沿用下载。
 */
export function AttachmentPreviewButton({ file }: { file: PreviewFile }) {
  const [open, setOpen] = useState(false)
  const format = previewFormat(file)
  if (!format) return null
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="pointer-coarse:min-h-11 pointer-coarse:min-w-11"
          aria-label={`预览附件 ${file.fileName}`}
        >
          预览
        </Button>
      </DialogTrigger>
      {open && (
        <DialogContent className="attachment-preview-dialog gap-3" aria-describedby={undefined}>
          <DialogHeader className="pr-8">
            <DialogTitle className="text-base wrap-anywhere">{file.fileName}</DialogTitle>
          </DialogHeader>
          <div className="min-h-0 overflow-auto rounded-lg bg-muted p-3 text-sm">
            <PreviewBody file={file} format={format} />
          </div>
          <div className="flex justify-end">
            <Button asChild variant="outline" size="sm">
              <a href={attachmentDownloadPath(file.id)} download={file.fileName}>
                下载附件
              </a>
            </Button>
          </div>
        </DialogContent>
      )}
    </Dialog>
  )
}
