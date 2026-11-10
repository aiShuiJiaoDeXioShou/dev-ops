import type { ReactNode } from 'react'
import { useSpinDelay } from 'spin-delay'

/** 延迟显示加载占位的默认时长（毫秒）；短于该时长的请求直接呈现内容，避免骨架屏闪烁。 */
export const DEFAULT_LOADING_DELAY_MS = 200

interface DelayedLoadingProps {
  /** 是否处于加载中；调用方应在加载分支中渲染本组件。 */
  pending: boolean
  /** 延迟满足后展示的加载占位，例如骨架屏或 PageLoading。 */
  children: ReactNode
  /** 延迟时长（毫秒），默认 200；仅用于测试或确有必要的特殊场景。 */
  delay?: number
}

/**
 * 延迟渲染加载占位，避免快速请求导致的骨架屏闪烁。
 *
 * 页面切换后组件先发起查询，若响应很快，整页骨架只存在一两帧，视觉上表现为闪烁。
 * 业界做法是延迟出现加载态（NN/g 的建议是小于 1 秒的加载不需要反馈）：
 * 超过延迟仍未就绪才显示骨架，让快速响应直接进入内容，慢请求仍有明确的加载反馈。
 *
 * 实现基于 spin-delay 的 `useSpinDelay`：应用是纯客户端渲染，固定 `ssr: false`
 * 避免库在首次渲染阶段直接展示占位；`minDuration: 0` 表示占位一旦出现就由数据就绪驱动移除，
 * 不为已就绪内容额外增加等待。
 *
 * @param props.pending 是否处于加载中；为 false 时不渲染任何占位。
 * @param props.children 延迟满足后要渲染的加载占位。
 * @param props.delay 延迟时长（毫秒），默认 {@link DEFAULT_LOADING_DELAY_MS}。
 * @returns 到达延迟且仍在加载时返回加载占位，否则返回 null。
 */
export function DelayedLoading({ pending, children, delay = DEFAULT_LOADING_DELAY_MS }: DelayedLoadingProps) {
  const visible = useSpinDelay(pending, { delay, minDuration: 0, ssr: false })

  if (!pending || !visible) return null
  return <>{children}</>
}
