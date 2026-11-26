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

it('渲染 GFM 表格、任务列表、删除线、自动链接和脚注', () => {
  const { container } = render(
    <Markdown>
      {
        '| 名称 | 图片 |\n| :--- | ---: |\n| ~~旧版~~ | ![截图](assets/a.png) |\n\n- [x] 已完成\n- [ ] 待办\n\nhttps://example.test\n\n正文[^1]\n\n[^1]: 注释'
      }
    </Markdown>,
  )
  expect(screen.getByRole('table')).toBeInTheDocument()
  expect(container.querySelector('del')).toHaveTextContent('旧版')
  expect(screen.getByRole('checkbox', { name: '已完成' })).toBeChecked()
  expect(screen.getByRole('checkbox', { name: '未完成' })).toBeDisabled()
  expect(screen.getByRole('link', { name: 'https://example.test' })).toHaveAttribute('href', 'https://example.test')
  expect(container.querySelector('[data-footnotes]')).toBeInTheDocument()
})

it('保留安全 HTML 图片、折叠区与标题锚点，解析 Markdown 和 HTML 相对资源', () => {
  const { container } = render(
    <Markdown resolveUrl={(url) => (url.startsWith('#') ? url : `https://example.test/${url}`)}>
      {
        '# 标题\n\n[跳转](#标题)\n\n<details><summary>更多</summary><img src="docs/a.png" width="320" alt="手机" /></details>\n\n![桌面](docs/b.png)'
      }
    </Markdown>,
  )
  expect(container.querySelector('details summary')).toHaveTextContent('更多')
  expect(screen.getByRole('img', { name: '手机' })).toHaveAttribute('src', 'https://example.test/docs/a.png')
  expect(screen.getByRole('img', { name: '手机' })).toHaveAttribute('width', '320')
  expect(screen.getByRole('img', { name: '桌面' })).toHaveAttribute('src', 'https://example.test/docs/b.png')
  expect(screen.getByRole('heading', { name: '标题' })).toHaveAttribute('id', 'user-content-标题')
  expect(screen.getByRole('link', { name: '跳转' })).toHaveAttribute('href', '#user-content-%E6%A0%87%E9%A2%98')
})

it('渲染公式与表情，并过滤 HTML 注入', () => {
  const { container } = render(
    <Markdown>
      {
        '$x^2$ :smile:\n\n<iframe src="https://evil.test"></iframe><img src="javascript:alert(1)" onerror="alert(1)"><div style="position:fixed">正文</div>'
      }
    </Markdown>,
  )
  expect(container.querySelector('.katex')).toBeInTheDocument()
  expect(container.textContent).toContain('😄')
  expect(container.querySelector('iframe')).toBeNull()
  expect(container.innerHTML).not.toMatch(/javascript:|onerror|position:fixed/)
})

it('渲染 GitHub 提示块且保留内部格式', () => {
  const { container } = render(<Markdown>{'> [!WARNING]\n> **注意**正文'}</Markdown>)
  expect(container.querySelector('[data-alert="WARNING"]')).toHaveTextContent(/WARNING\s*注意正文/)
  expect(container.querySelector('[data-alert="WARNING"] p strong')).toHaveTextContent('注意')
})
