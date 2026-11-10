import { describe, expect, it } from 'vitest'
import {
  createSkillPackageZip,
  generateSkillMarkdown,
  readSkillPackageDirectory,
  splitSkillFrontmatter,
} from './skill-package'

describe('skill-package', () => {
  it('生成并解析 SKILL.md frontmatter', () => {
    const markdown = generateSkillMarkdown('code-review', '提交前检查风险', '## 步骤\n1. 阅读变更')
    expect(markdown.startsWith('---\nname: code-review\ndescription:')).toBe(true)
    const parsed = splitSkillFrontmatter(markdown)
    expect(parsed.name).toBe('code-review')
    expect(parsed.description).toBe('提交前检查风险')
    expect(parsed.body).toContain('1. 阅读变更')
  })

  it('技能包 ZIP 包含 SKILL.md 与资源文件签名', async () => {
    const blob = createSkillPackageZip({ identifier: 'code-review', summary: '简述', content: '正文' }, [
      { path: 'scripts/lint.sh', content: 'echo ok', encoding: 'utf8' },
    ])
    const bytes = new Uint8Array(await blob.arrayBuffer())
    expect(Array.from(bytes.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04])
    const text = new TextDecoder().decode(bytes)
    expect(text).toContain('SKILL.md')
    expect(text).toContain('scripts/lint.sh')
  })
})

describe('readSkillPackageDirectory', () => {
  it('从目录导入 SKILL.md、资源文件与二进制资源', async () => {
    const skillFile = new File(
      ['---\nname: code-review\ndescription: "提交前检查风险"\n---\n\n## 步骤\n1. 阅读变更'],
      'SKILL.md',
      { type: 'text/markdown' },
    )
    const scriptFile = new File(['#!/bin/sh\necho ok'], 'run.sh', { type: 'text/x-shellscript' })
    const imageFile = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff])], 'logo.png', {
      type: 'image/png',
    })
    Object.defineProperty(skillFile, 'webkitRelativePath', { value: 'code-review/SKILL.md' })
    Object.defineProperty(scriptFile, 'webkitRelativePath', { value: 'code-review/scripts/run.sh' })
    Object.defineProperty(imageFile, 'webkitRelativePath', { value: 'code-review/assets/logo.png' })

    const imported = await readSkillPackageDirectory([skillFile, scriptFile, imageFile])
    expect(imported.frontmatterName).toBe('code-review')
    expect(imported.summary).toBe('提交前检查风险')
    expect(imported.body).toContain('1. 阅读变更')
    expect(imported.files.map((file) => file.path)).toEqual(['scripts/run.sh', 'assets/logo.png'])
    expect(imported.files[0]?.encoding).toBe('utf8')
    expect(imported.files[1]?.encoding).toBe('base64')
  })
})
