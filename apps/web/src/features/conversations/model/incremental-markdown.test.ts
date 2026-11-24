import { describe, expect, it } from 'vitest'
import { splitStreamingMarkdown } from './incremental-markdown'

describe('Markdown 流式切分', () => {
  it('复用已冻结的片段，尾部保留 GFM 表格形成所需的段落', () => {
    const firstSource = '## 已完成\n\n正文\n\n| 列名 |'
    const first = splitStreamingMarkdown(firstSource)
    expect(first.frozen).toEqual([{ offset: 0, source: '## 已完成' }])
    const next = splitStreamingMarkdown(firstSource + '\n| --- |\n| 内容 |\n\n尾注', first)
    expect(next.frozen[0]).toBe(first.frozen[0])
    expect(next.tail.source).toContain('| 列名 |\n| --- |\n| 内容 |')
    expect(next.frozen.map(({ source }) => source).join('') + next.tail.source).toBe(next.source)
  })

  it('替换正文时清除旧的稳定块，保留未闭合代码围栏内的空行', () => {
    const first = splitStreamingMarkdown('一\n\n二\n\n三')
    const replacement = '```py\nimport os\n\n'
    const next = splitStreamingMarkdown(replacement, first)
    expect(next.frozen).toEqual([])
    expect(next.tail).toEqual({ offset: 0, source: replacement })
  })
})
