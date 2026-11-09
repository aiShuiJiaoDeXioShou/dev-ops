import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Markdown } from './markdown'

describe('Markdown', () => {
  it('渲染标题、列表与安全链接', () => {
    render(<Markdown>{'# 标题\n\n- 条目\n\n[文档](https://example.test/doc)'}</Markdown>)
    expect(screen.getByRole('heading', { name: '标题' })).toBeInTheDocument()
    expect(screen.getByText('条目')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '文档' })).toHaveAttribute('href', 'https://example.test/doc')
  })

  it('过滤脚本、事件属性与非法协议链接', () => {
    const { container } = render(
      <Markdown>
        {'<script>alert(1)</script>\n\n<img src="x" onerror="alert(1)" />\n\n[危险](javascript:alert(1))'}
      </Markdown>,
    )
    expect(container.querySelector('script')).toBeNull()
    expect(container.innerHTML).not.toContain('onerror')
    expect(container.innerHTML).not.toContain('javascript:')
    const link = container.querySelector('a')
    expect(link?.getAttribute('href') ?? null).toBeNull()
  })
})
