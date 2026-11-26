import { describe, expect, it } from 'vitest'
import { repositoryMarkdownUrl } from './markdown-url'

const repository = {
  providerKey: 'github',
  webUrl: 'https://github.com/team/repo',
  branch: 'feature/docs',
  path: 'docs/README.md',
}
describe('仓库 Markdown 地址', () => {
  it('按目录和分支解析图片、根路径和链接', () => {
    expect(repositoryMarkdownUrl('../图片.png', 'image', repository)).toBe(
      'https://raw.githubusercontent.com/team/repo/feature%2Fdocs/%E5%9B%BE%E7%89%87.png',
    )
    expect(repositoryMarkdownUrl('/assets/a.png?raw=1#view', 'image', repository)).toBe(
      'https://raw.githubusercontent.com/team/repo/feature%2Fdocs/assets/a.png?raw=1#view',
    )
    expect(repositoryMarkdownUrl('./guide.md#标题', 'link', repository)).toBe(
      'https://github.com/team/repo/blob/feature%2Fdocs/docs/guide.md#标题',
    )
    expect(repositoryMarkdownUrl('#标题', 'link', repository)).toBe('#标题')
  })
  it('拒绝越界、非法编码与编码分隔符', () => {
    for (const path of ['../../secret', '%ZZ', 'a%2fb', 'a%5cb'])
      expect(repositoryMarkdownUrl(path, 'image', repository)).toBe('')
  })
  it('支持 Gitea 与外部图片', () => {
    expect(
      repositoryMarkdownUrl('a.png', 'image', {
        ...repository,
        providerKey: 'gitea',
        webUrl: 'https://git.example/team/repo',
      }),
    ).toBe('https://git.example/team/repo/raw/branch/feature%2Fdocs/docs/a.png')
    expect(repositoryMarkdownUrl('https://img.shields.io/a.svg', 'image', repository)).toBe(
      'https://img.shields.io/a.svg',
    )
  })
})
