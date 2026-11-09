import { describe, expect, it } from 'vitest'
import { canWriteRequirements, isEditable } from './mutations'

describe('需求权限与可编辑状态', () => {
  it('仅管理员/开发者可写', () => {
    expect(canWriteRequirements('admin')).toBe(true)
    expect(canWriteRequirements('developer')).toBe(true)
    expect(canWriteRequirements('viewer')).toBe(false)
  })
  it('仅待处理/开发中可编辑范围字段', () => {
    expect(isEditable('pending')).toBe(true)
    expect(isEditable('in_development')).toBe(true)
    expect(isEditable('in_testing')).toBe(false)
    expect(isEditable('passed')).toBe(false)
  })
})
