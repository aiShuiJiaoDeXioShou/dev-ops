import { describe, expect, it } from 'vitest'
import { canWriteBugs, isBugScopeEditable } from './mutations'

describe('Bug 权限与可编辑状态', () => {
  it('仅管理员/开发者可写', () => {
    expect(canWriteBugs('admin')).toBe(true)
    expect(canWriteBugs('developer')).toBe(true)
    expect(canWriteBugs('viewer')).toBe(false)
  })
  it('仅待处理/修复中可编辑核心字段', () => {
    expect(isBugScopeEditable('pending')).toBe(true)
    expect(isBugScopeEditable('in_fix')).toBe(true)
    expect(isBugScopeEditable('in_regression')).toBe(false)
    expect(isBugScopeEditable('closed')).toBe(false)
  })
})
