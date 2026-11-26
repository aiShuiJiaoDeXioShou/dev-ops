import { Link } from 'react-router'
import { Server } from 'lucide-react'
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
import { EmptyState } from '@/shared/ui/page-state'
import { StatusBadge } from '@/shared/ui/status-badge'
import { nodeStatusLabel, nodeStatusTone } from '../lib/status'
import type { PipelineNode } from '../model/types'

interface PipelineNodesDialogProps {
  /** 是否打开弹窗。 */
  open: boolean
  /** 打开状态变化回调。 */
  onOpenChange: (open: boolean) => void
  /** 团队自托管执行节点列表。 */
  nodes: PipelineNode[]
}

/**
 * 团队自托管执行节点速览弹窗。
 *
 * 帮助开发者快速确认节点在线状态与能力标签，判断排队原因或确认可用目标节点。
 * @param props 打开状态、节点列表。
 * @returns 执行节点状态对话框。
 */
export function PipelineNodesDialog({ open, onOpenChange, nodes }: PipelineNodesDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="pl-wide-dialog">
        <DialogHeader>
          <DialogTitle>自托管执行节点池</DialogTitle>
          <DialogDescription>
            流水线按工作流声明的 runs-on 标签匹配在线执行节点；无匹配在线节点时任务会保持排队等待。
          </DialogDescription>
        </DialogHeader>

        {nodes.length === 0 ? (
          <EmptyState
            icon={<Server />}
            title="还没有注册执行节点"
            description="在团队执行节点页面注册并启动 pipeline-agent 后，项目流水线即可分配到该节点运行。"
          />
        ) : (
          <div className="table-wrap">
            <Table aria-label="团队执行节点列表">
              <TableHeader>
                <TableRow>
                  <TableHead>节点名称</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>系统 / 架构</TableHead>
                  <TableHead>能力标签</TableHead>
                  <TableHead>并发上限</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {nodes.map((node) => (
                  <TableRow key={node.nodeId}>
                    <TableCell>
                      <span className="inline-flex items-center gap-2 font-medium">
                        <Server size={14} className="text-muted-foreground" aria-hidden="true" />
                        {node.name}
                      </span>
                    </TableCell>
                    <TableCell>
                      <StatusBadge tone={nodeStatusTone(node.status)}>{nodeStatusLabel(node.status)}</StatusBadge>
                    </TableCell>
                    <TableCell className="mono">
                      {node.os} / {node.arch}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {node.capabilities.map((cap) => (
                          <Badge key={cap} variant="secondary" className="mono">
                            {cap}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="mono">{node.concurrencyLimit}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <DialogFooter>
          <Button asChild variant="outline">
            <Link to="/settings/pipeline-nodes" onClick={() => onOpenChange(false)}>
              管理执行节点
            </Link>
          </Button>
          <Button type="button" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
