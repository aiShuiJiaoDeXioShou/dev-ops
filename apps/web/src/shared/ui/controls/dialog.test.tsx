import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Button } from './button'
import {
  Dialog,
  DialogContent,
  DialogFormBody,
  DialogFormFooter,
  DialogFormHeader,
  DialogHeader,
  DialogTitle,
} from './dialog'

describe('Dialog', () => {
  it('form 布局固定标题栏与底部操作栏，仅内容区滚动', () => {
    render(
      <Dialog open>
        <DialogContent layout="form">
          <DialogFormHeader>
            <DialogTitle>创建需求</DialogTitle>
          </DialogFormHeader>
          <DialogFormBody>字段内容</DialogFormBody>
          <DialogFormFooter>
            <Button>保存</Button>
          </DialogFormFooter>
        </DialogContent>
      </Dialog>,
    )
    const content = screen.getByRole('dialog')
    expect(content).toHaveAttribute('data-layout', 'form')
    expect(content.className).toContain('overflow-hidden')
    const header = content.querySelector('[data-slot="dialog-form-header"]')
    const body = content.querySelector('[data-slot="dialog-form-body"]')
    const footer = content.querySelector('[data-slot="dialog-form-footer"]')
    expect(header?.className).toContain('border-b')
    expect(body?.className).toContain('overflow-y-auto')
    expect(footer?.className).toContain('border-t')
    expect(body?.contains(header)).toBe(false)
    expect(body?.contains(footer)).toBe(false)
  })

  it('窄屏使用 16px 内边距，桌面使用 24px', () => {
    render(
      <Dialog open>
        <DialogContent layout="form">
          <DialogFormHeader>
            <DialogTitle>创建缺陷</DialogTitle>
          </DialogFormHeader>
          <DialogFormBody>字段内容</DialogFormBody>
          <DialogFormFooter>
            <Button>保存</Button>
          </DialogFormFooter>
        </DialogContent>
      </Dialog>,
    )
    const content = screen.getByRole('dialog')
    const body = content.querySelector('[data-slot="dialog-form-body"]')
    expect(body?.className).toContain('px-4')
    expect(body?.className).toContain('sm:px-6')
  })

  it('默认布局保持整块内容滚动，既有调用方行为不变', () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>项目设置</DialogTitle>
          </DialogHeader>
          <p>既有弹窗内容</p>
        </DialogContent>
      </Dialog>,
    )
    const content = screen.getByRole('dialog')
    expect(content).toHaveAttribute('data-layout', 'default')
    expect(content.className).toContain('overflow-y-auto')
    expect(content.querySelector('[data-slot="dialog-form-body"]')).toBeNull()
  })
})
