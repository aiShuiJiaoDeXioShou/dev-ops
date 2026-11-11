import { Link, useNavigate } from 'react-router'
import { Search } from 'lucide-react'
import { formatDateTime } from '@/shared/lib/format'
import { isNestedInteractiveTarget } from '@/shared/lib/clickable'
import { Button } from '@/shared/ui/controls/button'
import { Input } from '@/shared/ui/controls/input'
import { Select } from '@/shared/ui/controls/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/controls/table'
import { DelayedLoading } from '@/shared/ui/delayed-loading'
import { EmptyState, PageError, PageLoading } from '@/shared/ui/page-state'
import { Pagination } from '@/shared/ui/pagination'
import { formatDurationSeconds, hasRunFilters, runDurationSeconds, shortCommitSha } from '../lib/format'
import { RUN_FILTER_STATUSES, isPipelineRunStatus, runStatusLabel, runStatusTone } from '../lib/status'
import type { PipelineRunFilters, PipelineRunSummary } from '../model/types'
import { StatusLabel } from './status-label'

/** 工作流筛选项；来自工作流列表查询。 */
export interface RunHistoryWorkflowOption {
  path: string
  label: string
}

interface RunHistoryProps {
  /** 当前页运行摘要。 */
  runs: PipelineRunSummary[]
  /** 符合筛选条件的总条数。 */
  total: number
  /** 当前页码，从 1 开始。 */
  page: number
  /** 每页条数。 */
  pageSize: number
  /** 当前筛选条件。 */
  filters: PipelineRunFilters
  /** 工作流下拉选项；工作流列表尚未加载时为空。 */
  workflowOptions: RunHistoryWorkflowOption[]
  /** 项目详情页基础路径。 */
  projectBasePath: string
  /** 筛选变化；调用方负责写回 URL 并重置页码。 */
  onFiltersChange: (filters: PipelineRunFilters) => void
  /** 清除全部筛选。 */
  onClearFilters: () => void
  /** 页码变化。 */
  onPageChange: (page: number) => void
  /** 是否正在加载当前页。 */
  isPending: boolean
  /** 加载失败说明；非空时展示错误与重试。 */
  errorDescription: string | null
  /** 请求标识，便于排障。 */
  requestId: string | null
  /** 重试当前查询。 */
  onRetry: () => void
}

/**
 * 运行历史区：筛选工具栏 + 运行表格 + 分页。
 *
 * 空列表与筛选无结果区分展示；加载失败保留筛选工具栏并给出重试入口。
 * 行标题链接到运行详情，键盘可聚焦打开。
 * @param props 运行数据、筛选条件、分页状态与回调。
 * @returns 运行历史区域；无数据时按有无筛选展示不同空状态。
 */
export function RunHistory({
  runs,
  total,
  page,
  pageSize,
  filters,
  workflowOptions,
  projectBasePath,
  onFiltersChange,
  onClearFilters,
  onPageChange,
  isPending,
  errorDescription,
  requestId,
  onRetry,
}: RunHistoryProps) {
  const navigate = useNavigate()
  const filtersActive = hasRunFilters(filters)
  /** 没有任何运行记录时不展示筛选栏，避免空页面堆一排无效控件；有记录或已选条件时保留。 */
  const showFilters = filtersActive || isPending || total > 0 || runs.length > 0
  return (
    <section aria-label="运行历史">
      {showFilters ? (
        <div className="filters" role="group" aria-label="筛选运行历史">
          <label className="row small whitespace-nowrap">
            状态
            <Select
              aria-label="按状态筛选"
              value={filters.status}
              onChange={(event) => {
                const value = event.target.value
                if (value === '' || isPipelineRunStatus(value)) onFiltersChange({ ...filters, status: value })
              }}
            >
              <option value="">全部状态</option>
              {RUN_FILTER_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {runStatusLabel(status)}
                </option>
              ))}
            </Select>
          </label>
          <label className="row small whitespace-nowrap">
            工作流
            <Select
              aria-label="按工作流筛选"
              value={filters.workflowPath}
              onChange={(event) => onFiltersChange({ ...filters, workflowPath: event.target.value })}
            >
              <option value="">全部工作流</option>
              {workflowOptions.map((option) => (
                <option key={option.path} value={option.path}>
                  {option.label}
                </option>
              ))}
            </Select>
          </label>
          <label className="row small whitespace-nowrap">
            开始日期
            <Input
              type="date"
              aria-label="开始日期"
              className="w-40"
              value={filters.from}
              max={filters.to || undefined}
              onChange={(event) => onFiltersChange({ ...filters, from: event.target.value })}
            />
          </label>
          <label className="row small whitespace-nowrap">
            结束日期
            <Input
              type="date"
              aria-label="结束日期"
              className="w-40"
              value={filters.to}
              min={filters.from || undefined}
              onChange={(event) => onFiltersChange({ ...filters, to: event.target.value })}
            />
          </label>
          {filtersActive && (
            <Button type="button" variant="ghost" size="sm" onClick={onClearFilters}>
              清除筛选
            </Button>
          )}
        </div>
      ) : null}

      {isPending ? (
        <DelayedLoading pending>
          <PageLoading message="运行记录加载中…" />
        </DelayedLoading>
      ) : errorDescription !== null ? (
        <PageError title="运行记录加载失败" description={errorDescription} requestId={requestId} onRetry={onRetry} />
      ) : runs.length === 0 ? (
        filtersActive ? (
          <EmptyState
            icon={<Search />}
            title="没有匹配的运行"
            description="当前筛选条件下没有运行记录，可以清除筛选查看全部历史。"
            action={
              <Button type="button" variant="outline" onClick={onClearFilters}>
                清除筛选
              </Button>
            }
          />
        ) : (
          <EmptyState
            mascot="signal"
            title="还没有运行记录"
            description="在工作流页签触发一次运行后，运行历史会显示在这里。"
          />
        )
      ) : (
        <>
          <div className="table-wrap">
            <Table aria-label="流水线运行历史">
              <TableHeader>
                <TableRow>
                  <TableHead>运行</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>分支 / 提交</TableHead>
                  <TableHead>发起人</TableHead>
                  <TableHead>创建时间</TableHead>
                  <TableHead>耗时</TableHead>
                  <TableHead>操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((run) => (
                  <TableRow
                    key={run.runId}
                    className="clickable-row"
                    onClick={(event) => {
                      if (isNestedInteractiveTarget(event.target)) return
                      navigate(`${projectBasePath}/pipelines/${run.runId}`)
                    }}
                  >
                    <TableCell>
                      <Link to={`${projectBasePath}/pipelines/${run.runId}`} className="item-title">
                        <strong className="whitespace-nowrap">{run.workflowName ?? run.workflowPath}</strong>
                      </Link>
                      <div className="small quiet">
                        {run.workflowPath} · {run.runId.slice(0, 8)}
                      </div>
                    </TableCell>
                    <TableCell>
                      <StatusLabel tone={runStatusTone(run.status)}>{runStatusLabel(run.status)}</StatusLabel>
                    </TableCell>
                    <TableCell>
                      <div>{run.ref}</div>
                      <div className="small quiet mono">{shortCommitSha(run.commitSha)}</div>
                    </TableCell>
                    <TableCell>{run.initiator}</TableCell>
                    <TableCell>{formatDateTime(run.createdAt)}</TableCell>
                    <TableCell>{formatDurationSeconds(runDurationSeconds(run))}</TableCell>
                    <TableCell>
                      <Button asChild variant="ghost" size="sm">
                        <Link to={`${projectBasePath}/pipelines/${run.runId}`}>查看详情</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pagination page={page} pageSize={pageSize} total={total} onChange={onPageChange} />
        </>
      )}
    </section>
  )
}
