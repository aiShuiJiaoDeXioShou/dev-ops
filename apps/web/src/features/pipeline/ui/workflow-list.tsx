import { Link } from 'react-router'
import { Button } from '@/shared/ui/controls/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/controls/table'
import { EmptyState } from '@/shared/ui/page-state'
import { formatRelativeTime } from '@/shared/lib/format'
import { parseErrorLocation } from '../lib/format'
import { runStatusLabel, runStatusTone } from '../lib/status'
import type { PipelineWorkflowSummary } from '../model/types'
import { StatusLabel } from './status-label'

interface WorkflowListProps {
  /** 指定 ref 下解析出的工作流。 */
  workflows: PipelineWorkflowSummary[]
  /** 当前角色能否触发；浏览者只读。 */
  canTrigger: boolean
  /** 项目基础路径，用于拼接运行详情链接。 */
  projectBasePath: string
  /** 打开触发对话框；第二个参数为触发按钮，用于关闭后归还焦点。 */
  onTrigger: (workflow: PipelineWorkflowSummary, trigger: HTMLElement) => void
  /** 重新读取工作流列表。 */
  onRefresh: () => void
  /** 是否正在重新读取，用于禁用刷新按钮。 */
  isRefreshing: boolean
}

/** 工作流列表中没有可触发项时的说明。 */
function noRunnableHint(workflows: PipelineWorkflowSummary[]): string | null {
  const runnableCount = workflows.filter((workflow) => workflow.valid).length
  if (runnableCount > 0) return null
  return '当前没有可触发的工作流，请先修复解析错误后再触发。'
}

/**
 * 工作流列表：展示解析状态、错误定位与最近运行，并提供触发入口。
 *
 * 解析错误直接展示文件路径、字段与行号，不折叠、不静默忽略；
 * 无可触发工作流与只读角色分别给出说明。
 * @param props 工作流数据、权限、触发与刷新回调。
 * @returns 工作流表格；空列表时为可刷新空状态。
 */
export function WorkflowList({
  workflows,
  canTrigger,
  projectBasePath,
  onTrigger,
  onRefresh,
  isRefreshing,
}: WorkflowListProps) {
  const hint = noRunnableHint(workflows)
  return (
    <section aria-label="工作流">
      {workflows.length === 0 ? (
        <EmptyState
          mascot="signal"
          title="还没有流水线工作流"
          description="在仓库 .devops/workflows/ 下添加 .yml 或 .yaml 工作流文件后重新检查。"
          action={
            <Button type="button" onClick={onRefresh} disabled={isRefreshing}>
              {isRefreshing ? '检查中…' : '重新检查'}
            </Button>
          }
        />
      ) : (
        <>
          {!canTrigger && (
            <p className="section-note" role="note">
              当前角色可以查看工作流与运行记录，不能触发运行。如需触发，请联系项目管理员调整角色。
            </p>
          )}
          {canTrigger && hint !== null && <p className="section-note">{hint}</p>}
          <div className="table-wrap">
            <Table aria-label="流水线工作流">
              <TableHeader>
                <TableRow>
                  <TableHead>工作流</TableHead>
                  <TableHead>解析状态</TableHead>
                  <TableHead>最近运行</TableHead>
                  <TableHead>操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {workflows.map((workflow) => (
                  <TableRow key={workflow.path}>
                    <TableCell>
                      <div>
                        <strong>{workflow.name ?? workflow.path.split('/').at(-1) ?? workflow.path}</strong>
                      </div>
                      <div className="small quiet">{workflow.path}</div>
                    </TableCell>
                    <TableCell>
                      {workflow.valid ? (
                        <StatusLabel tone="success">可运行</StatusLabel>
                      ) : (
                        <StatusLabel tone="danger">解析失败</StatusLabel>
                      )}
                    </TableCell>
                    <TableCell>
                      {workflow.lastRun ? (
                        <span className="row">
                          <StatusLabel tone={runStatusTone(workflow.lastRun.status)}>
                            {runStatusLabel(workflow.lastRun.status)}
                          </StatusLabel>
                          <Link
                            to={`${projectBasePath}/pipelines/${workflow.lastRun.runId}`}
                            className="muted small whitespace-nowrap"
                            aria-label={`查看最近一次运行 ${runStatusLabel(workflow.lastRun.status)}`}
                          >
                            {formatRelativeTime(workflow.lastRun.createdAt)}
                          </Link>
                        </span>
                      ) : (
                        <span className="muted">尚未运行</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {workflow.valid && canTrigger ? (
                        <Button type="button" size="sm" onClick={(event) => onTrigger(workflow, event.currentTarget)}>
                          触发运行
                        </Button>
                      ) : (
                        <span className="muted small">{workflow.valid ? '只读' : '不可触发'}</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
      {workflows.some((workflow) => !workflow.valid) && (
        <section aria-label="解析错误" className="space-y-3">
          <h3>解析错误</h3>
          <ul className="plain-list">
            {workflows
              .filter((workflow) => !workflow.valid)
              .map((workflow) => (
                <li key={workflow.path} className="card">
                  <strong>{workflow.path}</strong>
                  <ul className="space-y-1">
                    {workflow.parseErrors.length === 0 ? (
                      <li className="small">未能读取具体错误，请重新检查工作流文件。</li>
                    ) : (
                      workflow.parseErrors.map((error, index) => (
                        <li key={`${error.code}-${index}`} className="small">
                          <span className="mono">{parseErrorLocation(error)}</span>
                          <span className="muted"> · {error.code}</span>
                          <p>{error.message}</p>
                        </li>
                      ))
                    )}
                  </ul>
                </li>
              ))}
          </ul>
        </section>
      )}
    </section>
  )
}
