import type { PipelineRunFilters, PipelineRunSummary } from '../model/types'
import { isPipelineRunStatus } from './status'

/**
 * 把秒数格式化为便于快速比较的耗时文案。
 * @param seconds 耗时秒数；null/undefined 或负数表示未知。
 * @returns “45 秒”“2 分 05 秒”“1 小时 02 分”；未知返回“—”。
 */
export function formatDurationSeconds(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return '—'
  const total = Math.round(seconds)
  if (total < 60) return `${total} 秒`
  const minutes = Math.floor(total / 60)
  if (minutes < 60) return `${minutes} 分 ${String(total % 60).padStart(2, '0')} 秒`
  return `${Math.floor(minutes / 60)} 小时 ${String(minutes % 60).padStart(2, '0')} 分`
}

/**
 * 根据运行时间字段计算耗时；优先使用接口给出的 durationSeconds。
 * @param run 运行摘要或详情。
 * @returns 秒数；缺少结束时间时按开始到当前计算，完全没有开始时间返回 null。
 */
export function runDurationSeconds(run: PipelineRunSummary): number | null {
  if (run.durationSeconds !== null && run.durationSeconds !== undefined) return run.durationSeconds
  if (!run.startedAt) return null
  const started = new Date(run.startedAt).getTime()
  if (Number.isNaN(started)) return null
  const finished = run.finishedAt ? new Date(run.finishedAt).getTime() : Date.now()
  if (Number.isNaN(finished) || finished < started) return null
  return Math.floor((finished - started) / 1000)
}

/**
 * 把字节数格式化为 K/M/G；用于产物大小展示。
 * @param bytes 字节数；非法值返回“—”。
 * @returns 例如“3.4 MB”。
 */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`
}

/**
 * 截断提交哈希用于列表与详情标题；完整哈希通过 title 或复制按钮提供。
 * @param sha 提交 SHA。
 * @returns 前 8 位；空值返回“—”。
 */
export function shortCommitSha(sha: string | null | undefined): string {
  if (!sha) return '—'
  return sha.slice(0, 8)
}

/** 解析错误定位文案：优先“字段 · 第 N 行”，只有其一则只显示一项。 */
export function parseErrorLocation(error: {
  fieldPath: string | null
  line: number | null
  column: number | null
}): string {
  const parts: string[] = []
  if (error.fieldPath) parts.push(error.fieldPath)
  if (error.line !== null)
    parts.push(error.column !== null ? `第 ${error.line} 行第 ${error.column} 列` : `第 ${error.line} 行`)
  return parts.join(' · ') || '文件级错误'
}

/** 空筛选条件。 */
export const EMPTY_RUN_FILTERS: PipelineRunFilters = { workflowPath: '', status: '', from: '', to: '' }

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/**
 * 从 URL 查询参数恢复运行筛选；非法状态与非法日期直接丢弃，避免把脏参数发给接口。
 * @param search 当前地址的查询参数。
 * @returns 规范化后的筛选条件。
 */
export function parseRunFilters(search: URLSearchParams): PipelineRunFilters {
  const status = search.get('status') ?? ''
  const from = search.get('from') ?? ''
  const to = search.get('to') ?? ''
  return {
    workflowPath: search.get('workflowPath') ?? '',
    status: isPipelineRunStatus(status) ? status : '',
    from: DATE_PATTERN.test(from) ? from : '',
    to: DATE_PATTERN.test(to) ? to : '',
  }
}

/**
 * 把筛选条件写回 URL 查询参数；空条件不写入，保持地址简洁。
 * @param filters 筛选条件。
 * @param page 页码；第一页不写入。
 * @returns 不含前导问号的查询串。
 */
export function serializeRunFilters(filters: PipelineRunFilters, page: number): string {
  const params = new URLSearchParams()
  if (filters.workflowPath) params.set('workflowPath', filters.workflowPath)
  if (filters.status) params.set('status', filters.status)
  if (filters.from) params.set('from', filters.from)
  if (filters.to) params.set('to', filters.to)
  if (page > 1) params.set('page', String(page))
  return params.toString()
}

/**
 * 判断是否存在任何筛选条件。
 * @param filters 筛选条件。
 * @returns 至少一项非空时为 true。
 */
export function hasRunFilters(filters: PipelineRunFilters): boolean {
  return Boolean(filters.workflowPath || filters.status || filters.from || filters.to)
}

/**
 * 从查询参数恢复页码。
 * @param search 当前地址的查询参数。
 * @returns 从 1 开始的正整数页码。
 */
export function parseRunPage(search: URLSearchParams): number {
  const raw = Number(search.get('page') ?? '1')
  return Number.isSafeInteger(raw) && raw >= 1 ? raw : 1
}
