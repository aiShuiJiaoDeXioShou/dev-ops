import { useId, useRef, useState, type FormEvent, type ReactNode, type RefObject } from 'react'
import { useMutation } from '@tanstack/react-query'
import { CalendarDays, Ellipsis, Pencil, Plus, Trash2 } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/ui/controls/alert-dialog'
import { Button } from '@/shared/ui/controls/button'
import { Checkbox } from '@/shared/ui/controls/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/controls/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/ui/controls/dropdown-menu'
import { StatusBadge } from '@/shared/ui/status-badge'
import { FormField } from '@/shared/ui/controls/form-field'
import { Input } from '@/shared/ui/controls/input'
import { useToast } from '@/shared/ui/toast'
import {
  isWorkflowStage,
  planNodeProgress,
  planNodes,
  workPlanRange,
  WORK_ITEM_NODE_LIMIT,
  type PlanNode,
  type PlanningKind,
  type WorkItemPlan,
} from '../model/work-item-plan'
import { WorkItemStageRail } from './work-item-stage-rail'

type Dates = Pick<PlanNode, 'title' | 'startsOn' | 'endsOn'>
type Target = { nodeId: string; taskId?: string; type: 'node' | 'task'; source?: WorkItemPlan }
type PlanSave = { next: WorkItemPlan; source?: WorkItemPlan; selectId?: string }
const MAX_TASKS = 30
type Editor = Target & { initial?: Dates; trigger: HTMLButtonElement }
type Removal = Target & { title: string; trigger: HTMLButtonElement }

function planDateLabel({ startsOn, endsOn }: Dates): string | null {
  if (startsOn && endsOn) return `${startsOn} 至 ${endsOn}`
  if (startsOn) return `${startsOn} 开始`
  if (endsOn) return `${endsOn} 截止`
  return null
}

function PlanEditorDialog({
  editor,
  pending,
  error,
  onSave,
  onClose,
}: {
  editor: Editor
  pending: boolean
  error: string | null
  onSave: (draft: Dates) => void
  onClose: () => void
}) {
  const [title, setTitle] = useState(editor.initial?.title ?? '')
  const [startsOn, setStartsOn] = useState(editor.initial?.startsOn ?? '')
  const [endsOn, setEndsOn] = useState(editor.initial?.endsOn ?? '')
  const titleId = useId()
  const startId = useId()
  const endId = useId()
  const dateError = startsOn && endsOn && startsOn > endsOn ? '结束日期不能早于开始日期。' : undefined
  const titleLabel = editor.type === 'node' ? '节点名称' : '任务名称'
  const dialogTitle = `${editor.initial ? '编辑' : '新增'}${editor.type === 'node' ? '节点' : '任务'}`
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (pending || !title.trim() || dateError) return
    onSave({ title: title.trim(), startsOn: startsOn || null, endsOn: endsOn || null })
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent
        onCloseAutoFocus={(event) => {
          if (!editor.trigger.isConnected) return
          event.preventDefault()
          editor.trigger.focus({ preventScroll: true })
        }}
      >
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
          <DialogDescription>
            {editor.type === 'node' && !editor.initial && '新节点插入所选节点之后。'}
            开始和结束日期都可以留空。
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
          <FormField label={titleLabel} htmlFor={titleId} required>
            <Input
              id={titleId}
              maxLength={120}
              value={title}
              required
              onChange={(event) => setTitle(event.target.value)}
            />
          </FormField>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="开始日期" htmlFor={startId}>
              <Input id={startId} type="date" value={startsOn} onChange={(event) => setStartsOn(event.target.value)} />
            </FormField>
            <FormField label="结束日期" htmlFor={endId} error={dateError}>
              <Input id={endId} type="date" value={endsOn} onChange={(event) => setEndsOn(event.target.value)} />
            </FormField>
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              取消
            </Button>
            <Button type="submit" disabled={pending || !title.trim() || Boolean(dateError)}>
              {pending ? '保存中…' : '保存'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/**
 * 在详情顶部切换和维护事项节点。当前节点的状态动作由业务模块提供。
 * @param props 事项类型、状态、规划、授权，以及负责人和状态动作的渲染入口。
 * @returns 一条共享时间线与选中节点的详情，包括本节点的任务和选填排期。
 */
export function WorkItemPlanning({
  kind,
  status,
  label,
  plan,
  canWrite,
  onSave,
  renderOwner,
  primaryAction,
  renderCurrentMenu,
  actionError,
}: {
  kind: PlanningKind
  status: string
  label: string
  plan?: WorkItemPlan
  canWrite: boolean
  onSave: (next: WorkItemPlan) => Promise<void>
  renderOwner: (nodeId: string, isCurrent: boolean) => ReactNode
  primaryAction?: ReactNode
  renderCurrentMenu?: (trigger: RefObject<HTMLButtonElement | null>) => ReactNode
  actionError: string
}) {
  const [selection, setSelection] = useState<{ status: string; id: string } | null>(null)
  const [editor, setEditor] = useState<Editor | null>(null)
  const [removal, setRemoval] = useState<Removal | null>(null)
  const addNode = useRef<HTMLButtonElement>(null)
  const addTask = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLButtonElement>(null)
  const cardId = useId()
  const { showToast } = useToast()
  const nodes = planNodes(kind, plan)
  const currentNode = nodes.find((node) => node.id === status)
  const lastSelected = selection?.status === status ? nodes.find((node) => node.id === selection.id) : undefined
  const node = lastSelected ?? currentNode ?? nodes[0]
  const range = workPlanRange(nodes)
  const mutation = useMutation({
    mutationFn: ({ next, source }: PlanSave) => {
      if (source !== plan) throw new Error('流程节点已被更新，请重新打开编辑后重试。')
      return onSave(next)
    },
    onSuccess: (_, { selectId }) => {
      if (selectId) setSelection({ status, id: selectId })
      setEditor(null)
      setRemoval(null)
      showToast('流程节点已更新。', 'success')
    },
  })
  const select = (id: string) => setSelection({ status, id })
  const error = mutation.error instanceof Error ? mutation.error.message : null

  if (!node) return null
  const isCurrent = node.id === status
  const isBuiltIn = isWorkflowStage(kind, node.id)
  const progress = planNodeProgress(kind, node, status)
  const currentMenu = isCurrent ? renderCurrentMenu : undefined
  const completed = node.tasks.filter((task) => task.done).length

  const openEditor = (target: Omit<Editor, 'source'>) => {
    if (mutation.isPending) return
    mutation.reset()
    setEditor({ ...target, source: plan })
  }
  const openRemoval = (target: Omit<Removal, 'source'>) => {
    if (mutation.isPending) return
    mutation.reset()
    setRemoval({ ...target, source: plan })
  }
  const applyEdit = (draft: Dates) => {
    if (!editor) return
    if (editor.type === 'node' && !editor.initial) {
      const id = crypto.randomUUID()
      const next = [...nodes]
      const anchorIndex = nodes.findIndex((entry) => entry.id === editor.nodeId)
      next.splice(anchorIndex + 1, 0, { ...draft, id, tasks: [] })
      mutation.mutate({ next, source: editor.source, selectId: id })
      return
    }
    const next = nodes.map((entry) => {
      if (entry.id !== editor.nodeId) return entry
      if (editor.type === 'node') return { ...entry, ...draft }
      const tasks = editor.taskId
        ? entry.tasks.map((task) => (task.id === editor.taskId ? { ...task, ...draft } : task))
        : [...entry.tasks, { ...draft, id: crypto.randomUUID(), done: false }]
      return { ...entry, tasks }
    })
    mutation.mutate({ next, source: editor.source })
  }
  const remove = () => {
    if (!removal) return
    if (removal.type === 'node') {
      const next = nodes.filter((entry) => entry.id !== removal.nodeId)
      const removedIndex = nodes.findIndex((entry) => entry.id === removal.nodeId)
      mutation.mutate({ next, source: removal.source, selectId: next[removedIndex]?.id ?? next.at(-1)?.id })
      return
    }
    const next = nodes.map((entry) =>
      entry.id === removal.nodeId
        ? { ...entry, tasks: entry.tasks.filter((task) => task.id !== removal.taskId) }
        : entry,
    )
    mutation.mutate({ next, source: removal.source })
  }

  return (
    <section className="space-y-3" aria-label={label}>
      <div className="work-item-flow-actions flex flex-wrap items-center justify-between gap-2">
        <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <CalendarDays className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="text-muted-foreground">总计划工期</span>
          <span>{range ? range.days + ' 天 · ' + range.startsOn + ' 至 ' + range.endsOn : '未排期'}</span>
        </p>
        <div className="ml-auto flex items-center gap-2">
          {!currentNode && primaryAction}
          {canWrite && (
            <Button
              ref={addNode}
              type="button"
              size="sm"
              variant="outline"
              disabled={mutation.isPending || nodes.length >= WORK_ITEM_NODE_LIMIT}
              onClick={(event) => openEditor({ type: 'node', nodeId: node.id, trigger: event.currentTarget })}
            >
              <Plus aria-hidden="true" />
              新增节点
            </Button>
          )}
        </div>
      </div>
      <WorkItemStageRail
        steps={nodes.map((entry) => ({
          id: entry.id,
          title: entry.title,
          progress: planNodeProgress(kind, entry, status),
        }))}
        currentId={status}
        selectedId={node.id}
        cardId={cardId}
        onSelect={select}
      />
      <section
        id={cardId}
        className="space-y-3 rounded-xl border border-border bg-card p-3 sm:p-4"
        aria-label="当前查看的节点"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h3 className="min-w-0 text-sm font-semibold wrap-anywhere sm:text-base">{node.title}</h3>
            {progress && (
              <StatusBadge tone={progress === '已完成' ? 'success' : progress === '未进入' ? 'neutral' : 'warning'}>
                {progress}
              </StatusBadge>
            )}
          </div>
          {(canWrite || currentMenu || (isCurrent && primaryAction)) && (
            <div className="work-item-flow-actions ml-auto flex items-center gap-2">
              {isCurrent && primaryAction}
              {(canWrite || currentMenu) && (
                <DropdownMenu modal={false}>
                  <DropdownMenuTrigger asChild>
                    <Button
                      ref={menu}
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="work-item-icon-button"
                      aria-label="更多节点操作"
                      disabled={mutation.isPending}
                    >
                      <Ellipsis aria-hidden="true" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {canWrite && (
                      <DropdownMenuItem
                        onSelect={() => {
                          if (menu.current)
                            openEditor({ type: 'node', nodeId: node.id, initial: node, trigger: menu.current })
                        }}
                      >
                        编辑节点
                      </DropdownMenuItem>
                    )}
                    {canWrite && !isBuiltIn && (
                      <DropdownMenuItem
                        className="text-destructive"
                        onSelect={() => {
                          if (menu.current)
                            openRemoval({ type: 'node', nodeId: node.id, title: node.title, trigger: menu.current })
                        }}
                      >
                        移除节点
                      </DropdownMenuItem>
                    )}
                    {canWrite && currentMenu && <DropdownMenuSeparator />}
                    {currentMenu?.(menu)}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          )}
        </div>
        <dl className="flex flex-wrap gap-x-8 gap-y-2 rounded-lg border border-border px-3 py-2.5">
          {renderOwner(node.id, isCurrent)}
          <div>
            <dt className="text-xs text-muted-foreground">节点排期</dt>
            <dd className="mt-1 text-sm">{planDateLabel(node) ?? '未设置'}</dd>
          </div>
        </dl>
        <div className="work-item-flow-actions flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-sm font-medium">
            全部任务{' '}
            <span className="text-muted-foreground">
              ({completed}/{node.tasks.length})
            </span>
          </h4>
          {canWrite && (
            <Button
              ref={addTask}
              type="button"
              size="sm"
              variant="outline"
              className="text-primary"
              disabled={mutation.isPending || node.tasks.length >= MAX_TASKS}
              onClick={(event) => openEditor({ type: 'task', nodeId: node.id, trigger: event.currentTarget })}
            >
              <Plus aria-hidden="true" />
              新增任务
            </Button>
          )}
        </div>
        {node.tasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">此节点暂无任务。</p>
        ) : (
          <ul className="divide-y divide-border border-t border-border" aria-label="节点任务">
            {node.tasks.map((task) => (
              <li key={task.id} className="flex items-center justify-between gap-2 py-1">
                <label className="work-item-task-check flex min-h-8 min-w-0 flex-1 items-center gap-2 text-sm">
                  <Checkbox
                    aria-label={task.title}
                    checked={task.done}
                    disabled={!canWrite || mutation.isPending}
                    onCheckedChange={(done) =>
                      mutation.mutate({
                        source: plan,
                        next: nodes.map((entry) =>
                          entry.id === node.id
                            ? {
                                ...entry,
                                tasks: entry.tasks.map((item) =>
                                  item.id === task.id ? { ...item, done: done === true } : item,
                                ),
                              }
                            : entry,
                        ),
                      })
                    }
                  />
                  <span className="min-w-0 wrap-anywhere">
                    <span className={task.done ? 'text-muted-foreground line-through' : undefined}>{task.title}</span>
                    <span className="block text-xs text-muted-foreground">{planDateLabel(task)}</span>
                  </span>
                </label>
                {canWrite && (
                  <div className="flex shrink-0 gap-1">
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="work-item-icon-button"
                      aria-label={'编辑任务 ' + task.title}
                      disabled={mutation.isPending}
                      onClick={(event) =>
                        openEditor({
                          type: 'task',
                          nodeId: node.id,
                          taskId: task.id,
                          initial: task,
                          trigger: event.currentTarget,
                        })
                      }
                    >
                      <Pencil aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="work-item-icon-button"
                      aria-label={'移除任务 ' + task.title}
                      disabled={mutation.isPending}
                      onClick={(event) =>
                        openRemoval({
                          type: 'task',
                          nodeId: node.id,
                          taskId: task.id,
                          title: task.title,
                          trigger: event.currentTarget,
                        })
                      }
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      {(actionError || (error && !editor && !removal)) && (
        <p role="alert" className="text-sm text-destructive">
          {actionError || error}
        </p>
      )}
      {editor && (
        <PlanEditorDialog
          editor={editor}
          pending={mutation.isPending}
          error={error}
          onSave={applyEdit}
          onClose={() => setEditor(null)}
        />
      )}
      {removal && (
        <AlertDialog open onOpenChange={(open) => !open && !mutation.isPending && setRemoval(null)}>
          <AlertDialogContent
            onCloseAutoFocus={(event) => {
              const fallback = removal.type === 'node' ? addNode.current : addTask.current
              const target = removal.trigger.isConnected ? removal.trigger : fallback
              if (!target) return
              event.preventDefault()
              target.focus({ preventScroll: true })
            }}
          >
            <AlertDialogHeader>
              <AlertDialogTitle>移除「{removal.title}」？</AlertDialogTitle>
              <AlertDialogDescription>
                {removal.type === 'node' ? '该节点及其中的任务会从时间线移除。' : '该任务会从节点中移除。'}
              </AlertDialogDescription>
            </AlertDialogHeader>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel disabled={mutation.isPending}>取消</AlertDialogCancel>
              <Button type="button" variant="destructive" disabled={mutation.isPending} onClick={remove}>
                {mutation.isPending ? '移除中…' : '移除'}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </section>
  )
}
