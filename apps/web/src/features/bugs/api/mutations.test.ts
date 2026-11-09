import { describe, expect, it } from 'vitest'
import { canWriteBugs, isEditableBug } from './mutations'

describe('Bug 权限与可编辑状态', () => {
  it('仅管理员/开发者可写', () => {
    expect(canWriteBugs('admin')).toBe(true)
    expect(canWriteBugs('developer')).toBe(true)
    expect(canWriteBugs('viewer')).toBe(false)
  })
  it('仅待处理/修复中可编辑核心字段', () => {
    expect(isEditableBug('pending')).toBe(true)
    expect(isEditableBug('in_fix')).toBe(true)
    expect(isEditableBug('in_regression')).toBe(false)
    expect(isEditableBug('closed')).toBe(false)
  })
})
