import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_LOADING_DELAY_MS, DelayedLoading } from './delayed-loading'

describe('DelayedLoading', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('加载时长未超过延迟时不渲染占位，避免快速请求造成骨架闪烁', () => {
    const { rerender } = render(
      <DelayedLoading pending>
        <p>骨架内容</p>
      </DelayedLoading>,
    )
    act(() => {
      vi.advanceTimersByTime(DEFAULT_LOADING_DELAY_MS - 1)
    })
    expect(screen.queryByText('骨架内容')).not.toBeInTheDocument()

    rerender(
      <DelayedLoading pending={false}>
        <p>骨架内容</p>
      </DelayedLoading>,
    )
    act(() => {
      vi.advanceTimersByTime(DEFAULT_LOADING_DELAY_MS)
    })
    expect(screen.queryByText('骨架内容')).not.toBeInTheDocument()
  })

  it('加载超过延迟后渲染占位，慢请求仍有明确反馈', () => {
    render(
      <DelayedLoading pending>
        <p>骨架内容</p>
      </DelayedLoading>,
    )
    act(() => {
      vi.advanceTimersByTime(DEFAULT_LOADING_DELAY_MS)
    })
    expect(screen.getByText('骨架内容')).toBeInTheDocument()
  })

  it('自定义延迟时长生效', () => {
    render(
      <DelayedLoading pending delay={50}>
        <p>骨架内容</p>
      </DelayedLoading>,
    )
    act(() => {
      vi.advanceTimersByTime(49)
    })
    expect(screen.queryByText('骨架内容')).not.toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(screen.getByText('骨架内容')).toBeInTheDocument()
  })

  it('卸载后清理定时器，不再更新状态', () => {
    const { unmount } = render(
      <DelayedLoading pending>
        <p>骨架内容</p>
      </DelayedLoading>,
    )
    unmount()
    act(() => {
      vi.advanceTimersByTime(DEFAULT_LOADING_DELAY_MS)
    })
    expect(screen.queryByText('骨架内容')).not.toBeInTheDocument()
  })
})
