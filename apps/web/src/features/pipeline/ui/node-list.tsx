import { formatDateTime, formatRelativeTime } from '@/shared/lib/format'
import { Button } from '@/shared/ui/controls/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/controls/table'
import { DelayedLoading } from '@/shared/ui/delayed-loading'
import { EmptyState, PageError, PageLoading } from '@/shared/ui/page-state'
import { nodeStatusLabel, nodeStatusTone } from '../lib/status'
import type { PipelineNode } from '../model/types'
import { StatusLabel } from './status-label'

interface NodeListProps {
  /** 团队执行节点。 */
  nodes: PipelineNode[]
  /** 是否正在加载节点列表。 */
  isPending: boolean
  /** 加载失败说明；非空时展示错误与重试。 */
  errorDescription: string | null
  /** 请求标识，便于排障。 */
  requestId: string | null
  /** 重试节点查询。 */
  onRetry: () => void
  /** 当前用户是否团队管理员；非管理员只读。 */
  canManage: boolean
  /** 排空节点：不再分配新运行，已有任务继续。第二个参数为触发按钮。 */
  onDrain: (node: PipelineNode, trigger: HTMLElement) => void
  /** 停用节点：需二次确认。第二个参数为触发按钮。 */
  onDisable: (node: PipelineNode, trigger: HTMLElement) => void
  /** 轮换 Agent 令牌：需二次确认，新令牌只显示一次。第二个参数为触发按钮。 */
  onRotate: (node: PipelineNode, trigger: HTMLElement) => void
  /** 是否有节点操作正在进行，用于禁用重复点击。 */
  isActionPending: boolean
  /** 新建节点入口，供空状态使用；参数为触发按钮，用于关闭对话框后归还焦点。 */
  onCreate: (trigger: HTMLElement) => void
}

/** 判断节点是否允许排空；只有在线节点才需要排空。 */
function canDrain(node: PipelineNode): boolean {
  return node.status === 'online'
}

/** 判断节点是否允许停用；已停用节点不再重复操作。 */
function canDisable(node: PipelineNode): boolean {
  return node.status !== 'disabled'
}

/** 判断节点是否允许轮换令牌；待注册与已停用节点没有活动 Agent 令牌。 */
function canRotate(node: PipelineNode): boolean {
  return node.status === 'online' || node.status === 'draining' || node.status === 'offline'
}

/**
 * 执行节点列表。
 *
 * 展示状态、能力标签、心跳、并发与 Agent 版本；写操作仅对管理员显示，
 * 排空/停用/轮换分别按节点状态禁用，服务端仍会再次校验权限与状态。
 * @param props 节点数据、权限、操作回调与加载状态。
 * @returns 节点表格；空列表时给出新建入口；非管理员展示只读说明。
 */
export function NodeList({
  nodes,
  isPending,
  errorDescription,
  requestId,
  onRetry,
  canManage,
  onDrain,
  onDisable,
  onRotate,
  isActionPending,
  onCreate,
}: NodeListProps) {
  return (
    <section aria-label="执行节点">
      <div className="section-heading">
        <h2>节点列表</h2>
        <span className="counter">{nodes.length}</span>
      </div>
      {isPending ? (
        <DelayedLoading pending>
          <PageLoading message="节点列表加载中…" />
        </DelayedLoading>
      ) : errorDescription !== null ? (
        <PageError title="节点列表加载失败" description={errorDescription} requestId={requestId} onRetry={onRetry} />
      ) : (
        <>
          {!canManage && (
            <p className="section-note" role="note">
              仅团队管理员可以查看完整的节点信息并管理节点。当前角色可以继续使用流水线，但不能注册或停用节点。
            </p>
          )}
          {nodes.length === 0 ? (
            <EmptyState
              mascot="signal"
              title="还没有执行节点"
              description="注册一台执行节点并复制一次性注册令牌，在节点机器上启动 Agent 后即可领取流水线任务。"
              action={
                canManage ? (
                  <Button type="button" onClick={(event) => onCreate(event.currentTarget)}>
                    新建执行节点
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div className="table-wrap">
              <Table aria-label="执行节点列表">
                <TableHeader>
                  <TableRow>
                    <TableHead>节点</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>能力标签</TableHead>
                    <TableHead>心跳</TableHead>
                    <TableHead>并发</TableHead>
                    <TableHead>Agent 版本</TableHead>
                    <TableHead>操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {nodes.map((node) => (
                    <TableRow key={node.nodeId}>
                      <TableCell>
                        <strong className="whitespace-nowrap">{node.name}</strong>
                        <div className="small quiet whitespace-nowrap">
                          {node.os} / {node.arch}
                          {node.currentRunId ? ` · 执行中 ${node.currentRunId.slice(0, 8)}` : ''}
                        </div>
                      </TableCell>
                      <TableCell>
                        <StatusLabel tone={nodeStatusTone(node.status)}>{nodeStatusLabel(node.status)}</StatusLabel>
                      </TableCell>
                      <TableCell>
                        <span className="row">
                          {node.capabilities.length === 0 ? (
                            <span className="muted">无标签</span>
                          ) : (
                            node.capabilities.map((capability) => (
                              <span key={capability} className="badge">
                                {capability}
                              </span>
                            ))
                          )}
                        </span>
                      </TableCell>
                      <TableCell title={formatDateTime(node.lastHeartbeatAt)}>
                        {node.lastHeartbeatAt ? formatRelativeTime(node.lastHeartbeatAt) : '从未心跳'}
                      </TableCell>
                      <TableCell>{node.concurrencyLimit}</TableCell>
                      <TableCell>{node.agentVersion ?? '—'}</TableCell>
                      <TableCell>
                        {canManage ? (
                          <span className="row">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              disabled={isActionPending || !canDrain(node)}
                              title={canDrain(node) ? undefined : '只有在线节点可以排空'}
                              onClick={(event) => onDrain(node, event.currentTarget)}
                            >
                              排空
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              disabled={isActionPending || !canDisable(node)}
                              title={canDisable(node) ? undefined : '节点已停用，无需重复操作'}
                              onClick={(event) => onDisable(node, event.currentTarget)}
                            >
                              停用
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              disabled={isActionPending || !canRotate(node)}
                              title={canRotate(node) ? undefined : '待注册或已停用节点没有活动 Agent 令牌'}
                              onClick={(event) => onRotate(node, event.currentTarget)}
                            >
                              轮换令牌
                            </Button>
                          </span>
                        ) : (
                          <span className="small muted">只读</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </>
      )}
    </section>
  )
}
