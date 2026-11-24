import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { gfm } from 'micromark-extension-gfm'

const markdownOptions = { extensions: [gfm({ singleTilde: false })], mdastExtensions: [gfmFromMarkdown()] }
const MUTABLE_BLOCK_COUNT = 2

type MarkdownSlice = { offset: number; source: string }

type StreamState = {
  source: string
  frozen: MarkdownSlice[]
  tail: MarkdownSlice
}

/**
 * 按 DSH 的方式冻结已完成的 Markdown 块，追加时仅分析最后两个可变块。
 * @param source 当前累计正文。
 * @param previous 上一次流式状态；内容替换时重新解析。
 * @returns 已冻结的稳定片段和仍可变化的尾部，结束后调用方重新解析完整正文以恢复跨块引用。
 */
export function splitStreamingMarkdown(source: string, previous?: StreamState): StreamState {
  if (source === previous?.source) return previous
  const isAppend = previous && source.startsWith(previous.source)
  const start = isAppend ? previous.tail.offset : 0
  const blocks = fromMarkdown(source.slice(start), markdownOptions).children.slice(0, -MUTABLE_BLOCK_COUNT)
  const frozen = isAppend ? [...previous.frozen] : []
  let offset = start
  for (const block of blocks) {
    const end = block.position?.end.offset
    if (end === undefined) break
    const next = start + end
    frozen.push({ offset, source: source.slice(offset, next) })
    offset = next
  }
  return { source, frozen, tail: { offset, source: source.slice(offset) } }
}
