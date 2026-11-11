import { describe, expect, it } from 'vitest'
import { avatarToneClassName } from './avatar-tone'

describe('avatarToneClassName', () => {
  it('同一成员始终得到同一色调', () => {
    expect(avatarToneClassName('user-1')).toBe(avatarToneClassName('user-1'))
  })

  it('色板来自语义 token 类名', () => {
    const tone = avatarToneClassName('user-1')
    expect(tone).toMatch(/^bg-(primary|success|warning|destructive|accent)\//)
    expect(tone).toMatch(/text-(primary|success|warning|destructive|accent-foreground)/)
  })

  it('不同成员可落到不同色调', () => {
    const tones = new Set(
      ['user-1', 'user-2', 'user-3', 'user-4', 'user-5', 'user-6'].map((id) => avatarToneClassName(id)),
    )
    expect(tones.size).toBeGreaterThan(1)
  })
})
