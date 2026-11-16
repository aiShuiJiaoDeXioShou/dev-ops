import { useId, useRef, useState, type FormEvent } from 'react'
import { useMutation } from '@tanstack/react-query'
import { CalendarDays, Pencil, Plus, Trash2 } from 'lucide-react'
import { describeRequestError } from '@/shared/api/errors'
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
import { FormField } from '@/shared/ui/controls/form-field'
import { Input } from '@/shared/ui/controls/input'
import { useToast } from '@/shared/ui/toast'
import {
  planNodes,
  workPlanRange,
  WORK_ITEM_STAGES,
  type PlanNode,
  type PlanningKind,
  type WorkItemPlan,
} from '../model/work-item-plan'

type Dates = Pick<PlanNode, 'title' | 'startsOn' | 'endsOn'>
type Target = { nodeId?: string; taskId?: string; type: 'node' | 'task'; source?: WorkItemPlan }
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
  const titleLabel = editor.type === 'node' ? '节点名称' : '待办名称'
  const dialogTitle = `${editor.initial ? '编辑' : '新增'}${editor.type === 'node' ? '节点' : '待办'}`
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
          <DialogDescription>开始和结束日期都可以留空。</DialogDescription>
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
 * 在需求或 Bug 详情中维护本事项的节点、待办和可选排期。
 * @param props 当前事项、已保存的规划、写入权限及带版本校验的保存回调。
 * @returns 节点和待办列表、总工期及就地编辑入口。
 */
export function WorkItemPlanning({
  kind,
  status,
  plan,
  canWrite,
  onSave,
}: {
  kind: PlanningKind
  status: string
  plan?: WorkItemPlan
  canWrite: boolean
  onSave: (next: WorkItemPlan) => Promise<void>
}) {
  const [editor, setEditor] = useState<Editor | null>(null)
  const [removal, setRemoval] = useState<Removal | null>(null)
  const addNode = useRef<HTMLButtonElement>(null)
  const { showToast } = useToast()
  const nodes = planNodes(kind, plan)
  const range = workPlanRange(nodes)
  const mutation = useMutation({
    mutationFn: ({ next, source }: { next: WorkItemPlan; source?: WorkItemPlan }) => {
      if (source !== plan) throw new Error('规划已被其他操作更新，请关闭编辑后重试。')
      return onSave(next)
    },
    onSuccess: () => {
      setEditor(null)
      setRemoval(null)
      showToast('节点与待办已更新。', 'success')
    },
  })
  const error = mutation.error instanceof Error ? mutation.error.message : null

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
    if (editor.type === 'node' && !editor.nodeId) {
      mutation.mutate({ next: [...nodes, { ...draft, id: crypto.randomUUID(), tasks: [] }], source: editor.source })
      return
    }
    const next = nodes.map((node) => {
      if (node.id !== editor.nodeId) return node
      if (editor.type === 'node') return { ...node, ...draft }
      const tasks = editor.taskId
        ? node.tasks.map((task) => (task.id === editor.taskId ? { ...task, ...draft } : task))
        : [...node.tasks, { ...draft, id: crypto.randomUUID(), done: false }]
      return { ...node, tasks }
    })
    mutation.mutate({ next, source: editor.source })
  }
  const remove = () => {
    if (!removal) return
    const next =
      removal.type === 'node'
        ? nodes.filter((node) => node.id !== removal.nodeId)
        : nodes.map((node) =>
            node.id === removal.nodeId
              ? { ...node, tasks: node.tasks.filter((task) => task.id !== removal.taskId) }
              : node,
          )
    mutation.mutate({ next, source: removal.source })
  }

  return (
    <section className="space-y-4" aria-label="节点与排期">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/50 p-3">
        <div className="flex min-w-0 items-start gap-2">
          <CalendarDays className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div>
            <p className="text-xs text-muted-foreground">总计划工期</p>
            <p className="mt-1 text-sm font-medium">
              {range ? `${range.days} 天 · ${range.startsOn} 至 ${range.endsOn}` : '未排期'}
            </p>
          </div>
        </div>
        {canWrite && (
          <Button
            ref={addNode}
            type="button"
            size="sm"
            variant="outline"
            disabled={mutation.isPending || nodes.length >= 24}
            onClick={(event) => openEditor({ type: 'node', trigger: event.currentTarget })}
          >
            <Plus aria-hidden="true" />
            新增节点
          </Button>
        )}
      </div>
      {mutation.isError && !editor && !removal && (
        <p role="alert" className="text-sm text-destructive">
          {error ?? describeRequestError(mutation.error).description}
        </p>
      )}
      <ol className="space-y-3" aria-label="规划节点">
        {nodes.map((node) => {
          const isStage = WORK_ITEM_STAGES[kind].some(([id]) => id === node.id)
          const dates = planDateLabel(node)
          const completed = node.tasks.filter((task) => task.done).length
          return (
            <li key={node.id} className="space-y-3 rounded-lg border border-border bg-card p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <h4 className="text-sm font-semibold wrap-anywhere">{node.title}</h4>
                  {(node.id === status || node.tasks.length > 0 || dates) && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {[
                        node.id === status && '当前节点',
                        node.tasks.length > 0 && `${completed}/${node.tasks.length} 项完成`,
                        dates,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  )}
                </div>
                {canWrite && (
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="work-item-icon-button"
                      aria-label={`编辑节点 ${node.title}`}
                      onClick={(event) =>
                        openEditor({ type: 'node', nodeId: node.id, initial: node, trigger: event.currentTarget })
                      }
                    >
                      <Pencil aria-hidden="true" />
                    </Button>
                    {!isStage && (
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="work-item-icon-button"
                        aria-label={`移除节点 ${node.title}`}
                        onClick={(event) =>
                          openRemoval({
                            type: 'node',
                            nodeId: node.id,
                            title: node.title,
                            trigger: event.currentTarget,
                          })
                        }
                      >
                        <Trash2 aria-hidden="true" />
                      </Button>
                    )}
                  </div>
                )}
              </div>
              {node.tasks.length > 0 && (
                <ul className="divide-y divide-border border-y border-border" aria-label={`${node.title}待办`}>
                  {node.tasks.map((task) => (
                    <li key={task.id} className="flex items-center justify-between gap-2 py-1">
                      <label className="flex min-h-8 min-w-0 items-center gap-2 text-sm">
                        <Checkbox
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
                          <span className={task.done ? 'text-muted-foreground line-through' : undefined}>
                            {task.title}
                          </span>
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
                            aria-label={`编辑待办 ${task.title}`}
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
                            aria-label={`移除待办 ${task.title}`}
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
              {canWrite && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={node.tasks.length >= 30}
                  onClick={(event) => openEditor({ type: 'task', nodeId: node.id, trigger: event.currentTarget })}
                >
                  <Plus aria-hidden="true" />
                  新增待办
                </Button>
              )}
            </li>
          )
        })}
      </ol>
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
              const target = removal.trigger.isConnected ? removal.trigger : addNode.current
              if (!target) return
              event.preventDefault()
              target.focus({ preventScroll: true })
            }}
          >
            <AlertDialogHeader>
              <AlertDialogTitle>移除「{removal.title}」？</AlertDialogTitle>
              <AlertDialogDescription>
                {removal.type === 'node' ? '该节点及其中的待办会从规划中移除。' : '该待办会从节点中移除。'}
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
