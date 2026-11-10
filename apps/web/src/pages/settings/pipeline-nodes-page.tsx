import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ShieldAlert } from 'lucide-react'
import { describeRequestError } from '@/shared/api/errors'
import { useSession } from '@/features/identity/public'
import {
  ConfirmActionDialog,
  CreateNodeDialog,
  NodeList,
  NodeTokenDialog,
  disablePipelineNode,
  drainPipelineNode,
  createPipelineNode,
  pipelineNodesQueryOptions,
  rotatePipelineNodeToken,
  useFocusReturn,
  type CreateNodeFormInput,
  type PipelineNode,
} from '@/features/pipeline/public'
import { Button } from '@/shared/ui/controls/button'
import { EmptyState } from '@/shared/ui/page-state'
import { useToast } from '@/shared/ui/toast'

/** 一次性令牌弹窗内容。 */
interface TokenDialogState {
  title: string
  description: string
  token: string
  expiresAt: string | null
}

/**
 * 管理员节点管理面板：列表、注册、排空、停用与令牌轮换。
 * @param props.teamId 当前团队标识。
 * @returns 节点管理与操作弹窗；登录页与权限提示由外层页面负责。
 */
function NodeManagementPanel({ teamId }: { teamId: string }) {
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const [createOpen, setCreateOpen] = useState(false)
  const [tokenDialog, setTokenDialog] = useState<TokenDialogState | null>(null)
  const [disableTarget, setDisableTarget] = useState<PipelineNode | null>(null)
  const [rotateTarget, setRotateTarget] = useState<PipelineNode | null>(null)
  const createFocus = useFocusReturn()
  const confirmFocus = useFocusReturn()
  const tokenFocus = useFocusReturn()
  const nodes = useQuery(pipelineNodesQueryOptions(teamId))

  const invalidateNodes = () => queryClient.invalidateQueries({ queryKey: ['pipeline', 'nodes', teamId] })

  const create = useMutation({
    mutationFn: (input: CreateNodeFormInput) => createPipelineNode(teamId, input),
    onSuccess: async (result) => {
      setCreateOpen(false)
      setTokenDialog({
        title: '节点注册令牌',
        description: `节点「${result.node.name}」已创建。请在节点机器上用该令牌启动 Agent，令牌只显示一次。`,
        token: result.registrationToken,
        expiresAt: result.expiresAt,
      })
      await invalidateNodes()
      showToast('执行节点已创建。', 'success')
    },
    onError: (error: unknown) => showToast(describeRequestError(error).description, 'error'),
  })

  const drain = useMutation({
    mutationFn: (nodeId: string) => drainPipelineNode(nodeId),
    onSuccess: async () => {
      await invalidateNodes()
      showToast('节点已进入排空状态，不再分配新运行。', 'success')
    },
    onError: (error: unknown) => showToast(describeRequestError(error).description, 'error'),
  })

  const disable = useMutation({
    mutationFn: (nodeId: string) => disablePipelineNode(nodeId),
    onSuccess: async () => {
      setDisableTarget(null)
      await invalidateNodes()
      showToast('节点已停用，活动 Agent 令牌已撤销。', 'success')
    },
    onError: (error: unknown) => showToast(describeRequestError(error).description, 'error'),
  })

  const rotate = useMutation({
    mutationFn: (nodeId: string) => rotatePipelineNodeToken(nodeId),
    onSuccess: async (result) => {
      const nodeName = rotateTarget?.name ?? '执行节点'
      setRotateTarget(null)
      setTokenDialog({
        title: '节点 Agent 令牌',
        description: `节点「${nodeName}」的旧 Agent 令牌已撤销。请用新令牌重启节点 Agent；新令牌只显示一次。`,
        token: result.token,
        expiresAt: result.expiresAt,
      })
      await invalidateNodes()
      showToast('Agent 令牌已轮换。', 'success')
    },
    onError: (error: unknown) => showToast(describeRequestError(error).description, 'error'),
  })

  const nodesError = nodes.isError ? describeRequestError(nodes.error) : null
  return (
    <div className="catalog space-y-8">
      <header className="row spread flex-wrap gap-3">
        <div>
          <h1>执行节点</h1>
          <p className="muted">管理团队自托管的流水线执行节点；注册令牌与 Agent 令牌只在创建或轮换后显示一次。</p>
        </div>
        <Button
          type="button"
          onClick={(event) => {
            createFocus.capture(event.currentTarget)
            tokenFocus.capture(event.currentTarget)
            setCreateOpen(true)
          }}
        >
          新建执行节点
        </Button>
      </header>

      <NodeList
        nodes={nodes.data?.items ?? []}
        isPending={nodes.isPending}
        errorDescription={nodesError?.description ?? null}
        requestId={nodesError?.requestId ?? null}
        onRetry={() => void nodes.refetch()}
        canManage
        onDrain={(node) => drain.mutate(node.nodeId)}
        onDisable={(node, trigger) => {
          confirmFocus.capture(trigger)
          setDisableTarget(node)
        }}
        onRotate={(node, trigger) => {
          confirmFocus.capture(trigger)
          tokenFocus.capture(trigger)
          setRotateTarget(node)
        }}
        isActionPending={drain.isPending || disable.isPending || rotate.isPending}
        onCreate={(trigger) => {
          createFocus.capture(trigger)
          tokenFocus.capture(trigger)
          setCreateOpen(true)
        }}
      />

      <CreateNodeDialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open)
          if (!open) createFocus.restore()
        }}
        onSubmit={(input) => create.mutate(input)}
        isSubmitting={create.isPending}
        errorMessage={create.isError ? describeRequestError(create.error).description : null}
      />

      <NodeTokenDialog
        open={tokenDialog !== null}
        onOpenChange={(open) => {
          if (open) return
          setTokenDialog(null)
          tokenFocus.restore()
        }}
        title={tokenDialog?.title ?? '节点令牌'}
        description={tokenDialog?.description ?? ''}
        token={tokenDialog?.token ?? ''}
        expiresAt={tokenDialog?.expiresAt ?? null}
      />

      <ConfirmActionDialog
        open={disableTarget !== null}
        onOpenChange={(open) => {
          if (open) return
          setDisableTarget(null)
          confirmFocus.restore()
        }}
        title={`停用节点「${disableTarget?.name ?? ''}」？`}
        description="停用后节点立即撤销活动 Agent 令牌，不再领取新任务；正在执行的运行会按租约收口为中断或取消。"
        confirmLabel="停用节点"
        pendingLabel="停用中…"
        isPending={disable.isPending}
        onConfirm={() => {
          if (disableTarget) disable.mutate(disableTarget.nodeId)
        }}
      />

      <ConfirmActionDialog
        open={rotateTarget !== null}
        onOpenChange={(open) => {
          if (open) return
          setRotateTarget(null)
          confirmFocus.restore()
        }}
        title={`轮换节点「${rotateTarget?.name ?? ''}」的令牌？`}
        description="旧 Agent 令牌会立即失效；节点上的 Agent 需要用新令牌重启后才能继续领取任务。"
        confirmLabel="轮换令牌"
        pendingLabel="轮换中…"
        isPending={rotate.isPending}
        onConfirm={() => {
          if (rotateTarget) rotate.mutate(rotateTarget.nodeId)
        }}
      />
    </div>
  )
}

/**
 * 团队执行节点管理页。
 *
 * 仅团队管理员可用；非管理员直接访问时展示权限说明而不是请求接口。
 * @returns 节点管理界面或权限/空团队提示。
 */
export function Component() {
  const { currentTeam, role } = useSession()
  if (!currentTeam) {
    return (
      <div className="catalog">
        <EmptyState
          mascot="group"
          title="还没有加入团队"
          description="执行节点属于团队资源，加入团队后由管理员注册与维护。"
        />
      </div>
    )
  }
  if (role !== 'admin') {
    return (
      <div className="catalog">
        <h1 className="sr-only">执行节点</h1>
        <EmptyState
          icon={<ShieldAlert />}
          title="仅团队管理员可管理执行节点"
          description="当前角色可以查看流水线运行，但不能注册、排空或停用节点。如需调整节点，请联系团队管理员。"
        />
      </div>
    )
  }
  return <NodeManagementPanel teamId={currentTeam.id} />
}

export default Component
