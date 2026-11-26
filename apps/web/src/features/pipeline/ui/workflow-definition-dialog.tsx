import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertCircle, FileCode2, Play, Terminal } from 'lucide-react'
import { describeRequestError } from '@/shared/api/errors'
import { Badge } from '@/shared/ui/controls/badge'
import { Button } from '@/shared/ui/controls/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/controls/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/controls/table'
import { DetailSheetSkeleton } from '@/shared/ui/page-skeleton'
import { PageError } from '@/shared/ui/page-state'
import { pipelineWorkflowDetailQueryOptions } from '../api/workflows'
import { parseErrorLocation, shortCommitSha, stepKindLabel } from '../lib/format'
import type { PipelineWorkflowSummary } from '../model/types'

interface WorkflowDefinitionDialogProps {
  /** 项目标识，用于拉取工作流 YAML 源码与计划。 */
  projectId: string
  /** 当前查看的工作流摘要；为空时不请求。 */
  workflow: PipelineWorkflowSummary | null
  /** 解析基准 ref。 */
  refName: string
  /** 弹窗是否打开。 */
  open: boolean
  /** 打开状态变更回调。 */
  onOpenChange: (open: boolean) => void
  /** 当前角色是否允许触发运行。 */
  canTrigger: boolean
  /** 点击“触发此工作流”回调。 */
  onTrigger: (workflow: PipelineWorkflowSummary) => void
}

/**
 * 工作流定义与执行计划弹窗。
 *
 * 按需调用工作流详情接口，展示执行计划（Jobs / Steps / 手动输入参数）与带行号的原始 YAML 快照，
 * 解析失败时高亮对应行并逐条展示字段路径与行号。
 * @param props 项目、工作流摘要、打开状态与触发回调。
 * @returns 工作流详情对话框。
 */
export function WorkflowDefinitionDialog({
  projectId,
  workflow,
  refName,
  open,
  onOpenChange,
  canTrigger,
  onTrigger,
}: WorkflowDefinitionDialogProps) {
  const [tab, setTab] = useState<'plan' | 'yaml'>('plan')

  useEffect(() => {
    if (open) setTab(workflow && !workflow.valid ? 'yaml' : 'plan')
  }, [open, workflow])

  const detail = useQuery({
    ...pipelineWorkflowDetailQueryOptions(projectId, workflow?.path ?? '', refName || undefined),
    enabled: open && Boolean(projectId && workflow?.path),
  })

  const data = detail.data?.workflow ?? null
  const errorLines = new Set(
    (data?.parseErrors ?? workflow?.parseErrors ?? [])
      .map((err) => err.line)
      .filter((line): line is number => typeof line === 'number'),
  )
  const effectiveErrors = data?.parseErrors ?? workflow?.parseErrors ?? []

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="pl-wide-dialog">
        <DialogHeader>
          <DialogTitle>{workflow ? `工作流定义 · ${workflow.name ?? workflow.path}` : '工作流定义'}</DialogTitle>
          <DialogDescription>
            查看仓库工作流的静态执行计划、声明的手动触发参数与原始 YAML 快照；不包含密钥明文。
          </DialogDescription>
        </DialogHeader>

        {workflow ? (
          <div className="space-y-4">
            <div className="pl-wf-facts">
              <span className="pl-wf-fact">
                <span className="pl-wf-fact-label">文件</span>
                <span className="mono">{workflow.path}</span>
              </span>
              <span className="pl-wf-fact">
                <span className="pl-wf-fact-label">基线</span>
                <span className="mono">
                  {data?.ref ?? (refName || '默认分支')}
                  {data?.commitSha ? ` · ${shortCommitSha(data.commitSha)}` : ''}
                </span>
              </span>
              <span className="pl-wf-fact">
                <span className="pl-wf-fact-label">执行节点标签</span>
                <span className="mono">{workflow.runsOn.join(', ') || '未声明'}</span>
              </span>
              {workflow.timeoutMinutes !== null ? (
                <span className="pl-wf-fact">
                  <span className="pl-wf-fact-label">超时上限</span>
                  <span>{workflow.timeoutMinutes} 分钟</span>
                </span>
              ) : null}
            </div>

            {detail.isPending ? (
              <DetailSheetSkeleton propertyRows={4} label="工作流定义加载中" />
            ) : detail.isError && !data ? (
              <PageError
                title="工作流定义加载失败"
                description={describeRequestError(detail.error).description}
                requestId={describeRequestError(detail.error).requestId}
                retrying={detail.isFetching}
                onRetry={() => void detail.refetch()}
              />
            ) : data ? (
              <>
                {!data.valid && effectiveErrors.length > 0 ? (
                  <div className="pl-parse-errors" role="alert">
                    {effectiveErrors.map((err, index) => (
                      <div key={`${err.code}-${index}`} className="pl-parse-error-item">
                        <AlertCircle size={15} className="pl-tone-danger pl-icon" aria-hidden="true" />
                        <div className="space-y-1">
                          <div className="pl-parse-error-meta">
                            <span className="mono">{parseErrorLocation(err)}</span>
                            <Badge variant="destructive">{err.code}</Badge>
                          </div>
                          <p className="text-foreground">{err.message}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}

                <div className="pl-subtabs">
                  <div className="pl-subtab-list" role="tablist" aria-label="工作流定义视图">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      role="tab"
                      className="pl-subtab"
                      aria-selected={tab === 'plan'}
                      onClick={() => setTab('plan')}
                    >
                      <Terminal size={14} aria-hidden="true" />
                      执行计划（{data.planJobs.length} 个阶段）
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      role="tab"
                      className="pl-subtab"
                      aria-selected={tab === 'yaml'}
                      onClick={() => setTab('yaml')}
                    >
                      <FileCode2 size={14} aria-hidden="true" />
                      YAML 源码快照
                    </Button>
                  </div>
                </div>

                {tab === 'plan' ? (
                  <div className="space-y-3">
                    {data.inputs.length > 0 ? (
                      <div className="space-y-2">
                        <strong className="text-sm font-medium">手动触发参数（workflow_dispatch.inputs）</strong>
                        <div className="table-wrap">
                          <Table aria-label="手动触发参数列表">
                            <TableHeader>
                              <TableRow>
                                <TableHead>参数名</TableHead>
                                <TableHead>类型</TableHead>
                                <TableHead>默认值 / 可选项</TableHead>
                                <TableHead>说明</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {data.inputs.map((input) => (
                                <TableRow key={input.name}>
                                  <TableCell className="mono">
                                    <span>{input.name}</span>
                                    {input.required ? (
                                      <Badge variant="secondary" className="ml-2">
                                        必填
                                      </Badge>
                                    ) : null}
                                  </TableCell>
                                  <TableCell>{input.type}</TableCell>
                                  <TableCell className="mono">
                                    {input.defaultValue !== undefined ? String(input.defaultValue) : '—'}
                                    {input.options ? ` (${input.options.join(' | ')})` : ''}
                                  </TableCell>
                                  <TableCell className="text-muted-foreground whitespace-normal">
                                    {input.description ?? '—'}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      </div>
                    ) : null}

                    {data.planJobs.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        解析失败的工作流无法生成运行计划，请先在仓库中修复 YAML 错误后提交。
                      </p>
                    ) : (
                      data.planJobs.map((job) => (
                        <div key={job.id} className="pl-plan-job-card">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <strong className="text-sm">{job.name}</strong>
                              <Badge variant="secondary" className="mono">
                                {job.id}
                              </Badge>
                            </div>
                            <span className="text-xs text-muted-foreground">{job.steps.length} 个步骤</span>
                          </div>
                          <div className="space-y-1.5">
                            {job.steps.map((step, idx) => (
                              <div key={step.index} className="pl-plan-step-row">
                                <span className="counter">{idx + 1}</span>
                                <span className="flex-1 text-foreground">{step.name}</span>
                                <Badge variant="outline">{stepKindLabel(step.kind)}</Badge>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                ) : (
                  <div className="pl-yaml-viewer" aria-label="YAML 源码">
                    {data.content.split('\n').map((line, index) => {
                      const lineNum = index + 1
                      const hasError = errorLines.has(lineNum)
                      return (
                        <div key={lineNum} className={`pl-yaml-line ${hasError ? 'has-error' : ''}`}>
                          <span className="pl-yaml-lineno">{lineNum}</span>
                          <span className="pl-yaml-code">{line || ' '}</span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </>
            ) : null}
          </div>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
          {workflow?.valid && canTrigger ? (
            <Button
              type="button"
              onClick={() => {
                onOpenChange(false)
                onTrigger(workflow)
              }}
            >
              <Play size={14} aria-hidden="true" />
              触发此工作流
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
