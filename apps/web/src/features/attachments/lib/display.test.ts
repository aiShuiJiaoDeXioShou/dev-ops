import { describe, expect, it } from 'vitest'
import { formatFileSize, truncateFileName } from './display'

describe('formatFileSize', () => {
  it('按字节、KB、MB 展示可读大小', () => {
    expect(formatFileSize(0)).toBe('0 B')
    expect(formatFileSize(1023)).toBe('1023 B')
    expect(formatFileSize(1024)).toBe('1 KB')
    expect(formatFileSize(1536)).toBe('1.5 KB')
    expect(formatFileSize(50 * 1024 * 1024)).toBe('50 MB')
  })

  it('异常字节数返回占位符', () => {
    expect(formatFileSize(-1)).toBe('—')
    expect(formatFileSize(Number.NaN)).toBe('—')
  })
})

describe('truncateFileName', () => {
  it('未超长时原样返回', () => {
    expect(truncateFileName('复现截图.png')).toBe('复现截图.png')
  })

  it('超长时中间省略并保留扩展名', () => {
    const fileName = `${'a'.repeat(60)}.png`
    const truncated = truncateFileName(fileName, 24)
    expect(truncated).toHaveLength(24)
    expect(truncated).toContain('…')
    expect(truncated.startsWith('a')).toBe(true)
    expect(truncated.endsWith('.png')).toBe(true)
  })

  it('无扩展名时仍保留首尾字符', () => {
    const fileName = 'x'.repeat(60)
    const truncated = truncateFileName(fileName, 20)
    expect(truncated).toHaveLength(20)
    expect(truncated).toContain('…')
  })
})
