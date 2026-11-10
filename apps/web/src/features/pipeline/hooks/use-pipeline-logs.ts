import { useCallback, useEffect, useRef, useState } from 'react'
import { describeRequestError } from '@/shared/api/errors'
import { apiClient } from '@/shared/api/client'
import type { PipelineLogChunk, PipelineLogPage } from '../model/types'

/** 运行中日志轮询间隔（毫秒）；终态停止轮询。 */
const LOG_POLL_INTERVAL_MS = 3000
/** 单次日志分页大小，与服务端上限 100 一致。 */
const LOG_PAGE_LIMIT = 100
/** 浏览器侧保留的最大日志分片数，防止超长日志拖垮页面。 */
const LOG_MAX_CHUNKS = 5000

/** 日志轮询状态。 */
export interface PipelineLogsState {
  /** 已收集的日志分片，按 seq 升序且无重复。 */
  chunks: PipelineLogChunk[]
  /** 首次读取是否仍在进行。 */
  isPending: boolean
  /** 读取失败的可读说明；已有内容时保留内容并展示错误。 */
  errorDescription: string | null
  /** 请求标识，便于排障。 */
  requestId: string | null
  /** 服务端分片被截断或达到浏览器侧上限。 */
  hasTruncatedContent: boolean
  /** 手动刷新：重新从头部读取当前步骤日志。 */
  refresh: () => void
}

/** 空状态常量，避免每次渲染创建新对象。 */
const EMPTY_CHUNKS: PipelineLogChunk[] = []

/**
 * 按步骤轮询运行日志。
 *
 * 首次读取从 afterSeq=-1 连续读取全部分页（包含 seq=0 的首片），随后仅在运行未结束时按固定间隔读取增量；
 * 重复 seq 只保留一次，运行结束或组件卸载时停止轮询。读取失败保留已加载内容，
 * 由调用方展示错误并提供重试/刷新。
 * @param runId 运行标识。
 * @param stepIndex 当前查看的步骤序号；空值表示无需读取。
 * @param isRunActive 运行是否仍在推进；终态时只读一次完整日志。
 * @returns 日志分片、加载/错误状态与刷新方法。
 */
export function usePipelineLogs(runId: string, stepIndex: number | null, isRunActive: boolean): PipelineLogsState {
  const [chunks, setChunks] = useState<PipelineLogChunk[]>(EMPTY_CHUNKS)
  const [isPending, setIsPending] = useState(Boolean(runId) && stepIndex !== null)
  const [errorDescription, setErrorDescription] = useState<string | null>(null)
  const [requestId, setRequestId] = useState<string | null>(null)
  const [hasTruncatedContent, setHasTruncatedContent] = useState(false)
  const [refreshToken, setRefreshToken] = useState(0)
  const activeRef = useRef(isRunActive)
  activeRef.current = isRunActive
  const refresh = useCallback(() => setRefreshToken((token) => token + 1), [])

  useEffect(() => {
    if (!runId || stepIndex === null) {
      setChunks(EMPTY_CHUNKS)
      setIsPending(false)
      setErrorDescription(null)
      setRequestId(null)
      setHasTruncatedContent(false)
      return
    }

    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const controller = new AbortController()
    const collected: PipelineLogChunk[] = []
    const seenSeq = new Set<number>()
    // 服务端 afterSeq 是“不含”游标且日志 seq 从 0 开始，起点必须用 -1 才能读到首片。
    let afterSeq = -1
    let truncated = false
    setIsPending(true)
    setErrorDescription(null)
    setHasTruncatedContent(false)

    /** 追加一页分片并返回是否还有更多。 */
    const appendPage = (page: PipelineLogPage): boolean => {
      for (const chunk of page.items) {
        if (seenSeq.has(chunk.seq)) continue
        seenSeq.add(chunk.seq)
        collected.push(chunk)
        if (chunk.truncated) truncated = true
      }
      afterSeq = page.nextSeq
      return page.hasMore
    }

    /** 达到上限或服务端截断时标记内容不完整。 */
    const markTruncatedIfNeeded = () => {
      if (collected.length >= LOG_MAX_CHUNKS) truncated = true
    }

    const scheduleNext = () => {
      if (cancelled || !activeRef.current || collected.length >= LOG_MAX_CHUNKS) return
      timer = setTimeout(() => void load(), LOG_POLL_INTERVAL_MS)
    }

    const load = async () => {
      try {
        let hasMore = true
        while (hasMore && !cancelled) {
          const result = await apiClient.listPipelineRunLogs(
            runId,
            { stepIndex, afterSeq, limit: LOG_PAGE_LIMIT },
            { signal: controller.signal },
          )
          if (cancelled) return
          setRequestId(result.requestId)
          hasMore = appendPage(result.data)
          markTruncatedIfNeeded()
          if (collected.length >= LOG_MAX_CHUNKS) break
        }
        if (cancelled) return
        setChunks([...collected])
        setIsPending(false)
        setErrorDescription(null)
        setHasTruncatedContent(truncated)
        scheduleNext()
      } catch (error) {
        if (cancelled) return
        setIsPending(false)
        setErrorDescription(describeRequestError(error).description)
        setHasTruncatedContent(truncated)
        scheduleNext()
      }
    }

    void load()
    return () => {
      cancelled = true
      controller.abort()
      if (timer !== null) clearTimeout(timer)
    }
  }, [runId, stepIndex, refreshToken])

  return { chunks, isPending, errorDescription, requestId, hasTruncatedContent, refresh }
}
