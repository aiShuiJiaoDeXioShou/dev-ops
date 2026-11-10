import { describe, expect, it } from 'vitest'
import { pickDefaultPreviewPath } from './default-preview'

describe('pickDefaultPreviewPath', () => {
  it('优先自动打开根目录 README.md', () => {
    expect(pickDefaultPreviewPath(['.gitignore', 'README.md', 'src/main.ts'])).toBe('README.md')
    expect(pickDefaultPreviewPath(['readme.MD'])).toBe('readme.MD')
  })

  it('没有根目录 README 时不自动选择其他文件', () => {
    expect(pickDefaultPreviewPath(['.gitignore', 'docs/guide.md', 'src/main.ts'])).toBe('')
    expect(pickDefaultPreviewPath([])).toBe('')
  })
})
