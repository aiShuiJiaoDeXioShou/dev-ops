import { Link } from 'react-router'
import { RefreshCw } from 'lucide-react'
import { formatDateTime } from '@/shared/lib/format'
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/controls/alert'
import { Button } from '@/shared/ui/controls/button'
import { formatDurationSeconds, runDurationSeconds } from '../lib/format'
import { runStatusLabel, runStatusTone } from '../lib/status'
import type { PipelineRunDetail } from '../model/types'
import { StatusLabel } from './status-label'

/** 终态或进行中状态的说明；成功与正常执行中返回 null。 */
interface RunReason {
  variant: 'destructive' | 'default'
  title: string
  description: string
}

/**
 * 根据运行状态与错误信息生成可读的终态/等待说明。
 * @param run 运行详情。
 * @returns 需要展示的说明；无额外说明时返回 null。
 */
function describeRunReason(run: PipelineRunDetail): RunReason | null {
  if (run.status === 'failed') {
    return {
      variant: 'destructive',
      title: '运行失败',
      description: run.errorMessage ?? '步骤执行失败，请查看步骤时间线与日志定位原因。',
    }
  }
  if (run.status === 'interrupted') {
    return {
      variant: 'destructive',
      title: '运行已中断',
      description:
        run.errorMessage ?? '执行节点失联或租约过期，平台已停止等待。已有日志与产物保留，可重新触发一次运行。',
    }
  }
  if (run.status === 'cancelled') {
    return {
      variant: 'default',
      title: '运行已取消',
      description: run.errorMessage ?? '取消请求已完成。已发生的镜像推送、文件上传等外部副作用无法撤回。',
    }
  }
  if (run.status === 'cancelling') {
    return {
      variant: 'default',
      title: '取消请求已发出',
      description: '正在等待执行节点确认停止。节点无响应时，运行最终可能标记为已中断。',
    }
  }
  if (run.status === 'queued') {
    return {
      variant: 'default',
      title: '运行排队中',
      description: '等待具备工作流 runs-on 能力标签的在线执行节点领取任务。',
    }
  }
  if (run.status === 'assigned') {
    return {
      variant: 'default',
      title: '运行已分配',
      description: '执行节点已领取任务，正在准备运行环境。',
    }
  }
  return null
}

const TRIGGER_CHANNEL_LABELS: Record<string, string> = { web: 'Web 页面', api: 'API' }

interface RunSummaryProps {
  /** 运行详情。 */
  run: PipelineRunDetail
  /** 项目详情页基础路径，用于返回运行列表。 */
  projectBasePath: string
  /** 当前角色能否取消运行。 */
  canCancel: boolean
  /** 是否正在提交取消请求。 */
  isCancelling: boolean
  /** 打开取消确认框；参数为触发按钮，用于关闭对话框后归还焦点。 */
  onCancel: (trigger: HTMLElement) => void
  /** 手动刷新运行详情。 */
  onRefresh: () => void
  /** 是否正在刷新。 */
  isRefreshing: boolean
}

/**
 * 运行详情头部：状态、关键元数据、终态说明与取消/刷新操作。
 *
 * 失败、取消、中断分别给出不同说明，避免把非成功状态展示成成功；
 * 只读角色隐藏取消入口，手动刷新随时可用。
 * @param props 运行详情、权限与操作回调。
 * @returns 运行概要与元数据；不发起请求。
 */
export function RunSummary({
  run,
  projectBasePath,
  canCancel,
  isCancelling,
  onCancel,
  onRefresh,
  isRefreshing,
}: RunSummaryProps) {
  const reason = describeRunReason(run)
  const canRequestCancel =
    canCancel && (run.status === 'queued' || run.status === 'assigned' || run.status === 'running')
  return (
    <section aria-label="运行概览" className="space-y-4">
      <nav className="breadcrumb" aria-label="面包屑">
        <Link to={`${projectBasePath}/pipelines`}>流水线</Link>
        <span>/</span>
        <span>运行 {run.runId.slice(0, 8)}</span>
      </nav>

      <header className="row spread">
        <div>
          <h1>{run.workflowName ?? run.workflowPath}</h1>
          <p className="small quiet">
            {run.workflowPath} · 运行 {run.runId}
          </p>
        </div>
        <div className="row">
          <StatusLabel tone={runStatusTone(run.status)}>{runStatusLabel(run.status)}</StatusLabel>
          <Button type="button" variant="outline" size="sm" onClick={onRefresh} disabled={isRefreshing}>
            <RefreshCw aria-hidden="true" />
            {isRefreshing ? '刷新中…' : '刷新'}
          </Button>
          {canRequestCancel && (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={isCancelling}
              onClick={(event) => onCancel(event.currentTarget)}
            >
              {isCancelling ? '取消中…' : '取消运行'}
            </Button>
          )}
        </div>
      </header>

      {reason && (
        <Alert variant={reason.variant}>
          <AlertTitle>{reason.title}</AlertTitle>
          <AlertDescription>
            <p>{reason.description}</p>
            {run.errorCode && <p className="small">错误码：{run.errorCode}</p>}
          </AlertDescription>
        </Alert>
      )}

      <dl className="properties">
        <dt>分支 / 提交</dt>
        <dd>
          {run.ref} · <span className="mono">{run.commitSha}</span>
        </dd>
        <dt>发起人</dt>
        <dd>
          {run.initiator}（{TRIGGER_CHANNEL_LABELS[run.initiatorChannel] ?? run.initiatorChannel}）
        </dd>
        <dt>执行节点</dt>
        <dd>{run.nodeName ?? run.nodeId ?? '尚未分配'}</dd>
        <dt>触发方式</dt>
        <dd>{run.triggerSource === 'manual' ? '手动触发' : run.triggerSource}</dd>
        <dt>创建时间</dt>
        <dd>{formatDateTime(run.createdAt)}</dd>
        <dt>开始时间</dt>
        <dd>{formatDateTime(run.startedAt)}</dd>
        <dt>结束时间</dt>
        <dd>{formatDateTime(run.finishedAt)}</dd>
        <dt>耗时</dt>
        <dd>{formatDurationSeconds(runDurationSeconds(run))}</dd>
        {Object.keys(run.inputs).length > 0 && (
          <>
            <dt>输入参数</dt>
            <dd className="mono">{JSON.stringify(run.inputs)}</dd>
          </>
        )}
      </dl>
    </section>
  )
}
