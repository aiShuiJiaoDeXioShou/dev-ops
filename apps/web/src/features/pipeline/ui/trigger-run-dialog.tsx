import { useEffect, useId, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createIdempotencyKey } from '@dev-ops/api-client'
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/controls/alert'
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
import { Input } from '@/shared/ui/controls/input'
import { Select } from '@/shared/ui/controls/select'
import { Switch } from '@/shared/ui/controls/switch'
import { Textarea } from '@/shared/ui/controls/textarea'
import { pipelineWorkflowDetailQueryOptions } from '../api/workflows'
import type {
  PipelineRunInputValue,
  PipelineWorkflowInput,
  PipelineWorkflowSummary,
  TriggerRunInput,
} from '../model/types'

interface TriggerRunDialogProps {
  /** 可选项目标识；提供时自动读取工作流定义以渲染结构化输入参数表单。 */
  projectId?: string
  /** 是否打开；由页面根据选中的工作流控制。 */
  open: boolean
  /** 打开状态变化回调；Esc 与遮罩关闭由 Radix 统一处理并归还焦点。 */
  onOpenChange: (open: boolean) => void
  /** 允许触发的工作流；解析失败的项不会出现在选项中。 */
  workflows: PipelineWorkflowSummary[]
  /** 打开对话框时选中的工作流路径。 */
  initialWorkflowPath: string
  /** 打开对话框时默认使用的分支或标签。 */
  defaultRef: string
  /** 提交触发请求；调用方负责 mutation 与错误处理。 */
  onSubmit: (input: TriggerRunInput) => void
  /** 提交中；按钮禁用并显示进度文案，避免重复提交。 */
  isSubmitting: boolean
  /** 上次提交失败的可读说明；非空时展示在表单顶部。 */
  errorMessage: string | null
  /** 可选的失败恢复操作，例如开启个人 GitHub 授权。 */
  errorAction?: ReactNode
}

const INPUTS_HELPER = '可选。按 workflow 声明的 inputs 填写 JSON 对象，例如 {"target":"web"}；留空表示使用默认值。'
const EMPTY_INPUTS: PipelineWorkflowInput[] = []

/**
 * 校验输入参数 JSON 并转换为接口可接受的值。
 * @param text 用户填写的 JSON 文本。
 * @returns 输入对象；空文本视为没有输入。
 * @throws 文本不是对象或包含嵌套值时抛出错误，由调用方展示字段错误。
 */
function parseInputsText(text: string): Record<string, PipelineRunInputValue> {
  if (!text.trim()) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('输入参数必须是合法 JSON。')
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('输入参数必须是 JSON 对象。')
  }
  const inputs: Record<string, PipelineRunInputValue> = {}
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
      throw new Error(`输入参数 ${key} 的值只支持字符串、数字或布尔值。`)
    }
    inputs[key] = value
  }
  return inputs
}

/** 根据工作流声明构造输入参数初始值表。 */
function buildDefaultInputs(definitions: PipelineWorkflowInput[]): Record<string, PipelineRunInputValue | ''> {
  const defaults: Record<string, PipelineRunInputValue | ''> = {}
  for (const def of definitions) {
    if (def.defaultValue !== undefined) defaults[def.name] = def.defaultValue
    else if (def.type === 'boolean') defaults[def.name] = false
    else if (def.type === 'choice' && def.options?.[0]) defaults[def.name] = def.options[0]
    else defaults[def.name] = ''
  }
  return defaults
}

/**
 * 手动触发运行对话框。
 *
 * 打开时聚焦工作流选择并预生成幂等键，同时按需加载工作流定义：
 * 若声明了 `workflow_dispatch.inputs`，自动生成对应类型的下拉、开关或输入框；
 * 未声明或切换至高级模式时支持 JSON 输入。提交失败保留输入并复用幂等键。
 * @param props 项目、工作流、默认值、提交状态与错误说明。
 * @returns 触发表单对话框；未打开时不渲染内容。
 */
export function TriggerRunDialog({
  projectId,
  open,
  onOpenChange,
  workflows,
  initialWorkflowPath,
  defaultRef,
  onSubmit,
  isSubmitting,
  errorMessage,
  errorAction,
}: TriggerRunDialogProps) {
  const fieldId = useId()
  const [workflowPath, setWorkflowPath] = useState(initialWorkflowPath)
  const [ref, setRef] = useState(defaultRef)
  const [inputsText, setInputsText] = useState('')
  const [structuredValues, setStructuredValues] = useState<Record<string, PipelineRunInputValue | ''>>({})
  const [useJsonMode, setUseJsonMode] = useState(false)
  const [idempotencyKey, setIdempotencyKey] = useState(() => createIdempotencyKey())
  const [fieldError, setFieldError] = useState<string | null>(null)

  const workflowDetail = useQuery({
    ...pipelineWorkflowDetailQueryOptions(projectId ?? '', workflowPath, defaultRef || undefined),
    enabled: open && Boolean(projectId && workflowPath),
    retry: false,
  })

  const declaredInputs = workflowDetail.data?.workflow.inputs ?? EMPTY_INPUTS
  const planJobs = workflowDetail.data?.workflow.planJobs ?? []
  const selectedWorkflow = workflows.find((item) => item.path === workflowPath) ?? null
  const hasStructuredInputs = declaredInputs.length > 0 && !useJsonMode

  // 每次重新打开都恢复默认值并换一个新的幂等键，避免复用上一次成功提交的键。
  useEffect(() => {
    if (!open) return
    const nextPath = initialWorkflowPath || workflows[0]?.path || ''
    setWorkflowPath(nextPath)
    setRef(defaultRef)
    setInputsText('')
    setStructuredValues({})
    setUseJsonMode(false)
    setIdempotencyKey(createIdempotencyKey())
    setFieldError(null)
  }, [open, initialWorkflowPath, defaultRef, workflows])

  useEffect(() => {
    if (!open || declaredInputs.length === 0) return
    setStructuredValues(buildDefaultInputs(declaredInputs))
  }, [open, workflowPath, declaredInputs])

  const submit = () => {
    if (!workflowPath) {
      setFieldError('请选择要触发的工作流。')
      return
    }
    if (!ref.trim()) {
      setFieldError('请填写分支、标签或提交 SHA。')
      return
    }
    if (!idempotencyKey.trim()) {
      setFieldError('幂等键不能为空。')
      return
    }
    let inputs: Record<string, PipelineRunInputValue> = {}
    if (hasStructuredInputs) {
      for (const def of declaredInputs) {
        const raw = structuredValues[def.name]
        if (def.type === 'boolean') {
          inputs[def.name] = Boolean(raw)
          continue
        }
        if (raw === undefined || raw === '') {
          if (def.required) {
            setFieldError(`请填写必填输入参数：${def.name}。`)
            return
          }
          continue
        }
        if (def.type === 'number') {
          const parsed = typeof raw === 'number' ? raw : Number(raw)
          if (!Number.isFinite(parsed)) {
            setFieldError(`输入参数 ${def.name} 必须是有效数字。`)
            return
          }
          inputs[def.name] = parsed
          continue
        }
        inputs[def.name] = String(raw)
      }
    } else {
      try {
        inputs = parseInputsText(inputsText)
      } catch (error) {
        setFieldError(error instanceof Error ? error.message : '输入参数不合法。')
        return
      }
    }
    setFieldError(null)
    onSubmit({ workflowPath, ref: ref.trim(), inputs, idempotencyKey: idempotencyKey.trim() })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
        >
          <DialogHeader>
            <DialogTitle>触发流水线运行</DialogTitle>
            <DialogDescription>
              触发时会固定当前提交与工作流快照；重复提交同一幂等键只会返回同一次运行。
            </DialogDescription>
          </DialogHeader>

          {errorMessage ? (
            <Alert variant="destructive">
              <AlertTitle>触发失败</AlertTitle>
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
          ) : null}
          {errorAction}

          <label className="block space-y-1.5 text-sm font-medium" htmlFor={`${fieldId}-workflow`}>
            工作流
            <Select
              id={`${fieldId}-workflow`}
              value={workflowPath}
              autoFocus
              disabled={isSubmitting}
              onChange={(event) => {
                setWorkflowPath(event.target.value)
                setStructuredValues({})
                setFieldError(null)
              }}
            >
              {workflows.map((workflow) => (
                <option key={workflow.path} value={workflow.path}>
                  {workflow.name ?? workflow.path}（{workflow.path}）
                </option>
              ))}
            </Select>
          </label>

          <label className="block space-y-1.5 text-sm font-medium" htmlFor={`${fieldId}-ref`}>
            分支、标签或提交 SHA
            <Input
              id={`${fieldId}-ref`}
              value={ref}
              maxLength={200}
              disabled={isSubmitting}
              onChange={(event) => setRef(event.target.value)}
            />
          </label>

          {selectedWorkflow && (planJobs.length > 0 || selectedWorkflow.runsOn.length > 0) ? (
            <div className="pl-wf-facts">
              {planJobs.length > 0 ? (
                <span className="pl-wf-fact">
                  <span className="pl-wf-fact-label">执行链路</span>
                  <span>{planJobs.map((job) => `${job.name} (${job.steps.length}步)`).join(' → ')}</span>
                </span>
              ) : null}
              {selectedWorkflow.runsOn.length > 0 ? (
                <span className="pl-wf-fact">
                  <span className="pl-wf-fact-label">目标节点</span>
                  <span className="mono">{selectedWorkflow.runsOn.join(', ')}</span>
                </span>
              ) : null}
            </div>
          ) : null}

          {hasStructuredInputs ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">工作流输入参数</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setUseJsonMode(true)}
                  disabled={isSubmitting}
                >
                  切换 JSON 编辑
                </Button>
              </div>
              <div className="pl-inputs-grid">
                {declaredInputs.map((input) => {
                  const val = structuredValues[input.name] ?? ''
                  if (input.type === 'boolean') {
                    return (
                      <div key={input.name} className="pl-switch-row">
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-1.5">
                            <span className="mono text-xs font-semibold">{input.name}</span>
                            {input.required ? <Badge variant="secondary">必填</Badge> : null}
                          </div>
                          {input.description ? (
                            <p className="text-xs text-muted-foreground">{input.description}</p>
                          ) : null}
                        </div>
                        <Switch
                          aria-label={input.name}
                          checked={Boolean(val)}
                          disabled={isSubmitting}
                          onCheckedChange={(checked) =>
                            setStructuredValues((prev) => ({ ...prev, [input.name]: checked }))
                          }
                        />
                      </div>
                    )
                  }
                  if (input.type === 'choice' && input.options) {
                    return (
                      <label
                        key={input.name}
                        className="block space-y-1 text-xs font-medium"
                        htmlFor={`${fieldId}-in-${input.name}`}
                      >
                        <span className="flex items-center gap-1.5">
                          <span className="mono">{input.name}</span>
                          {input.required ? <Badge variant="secondary">必填</Badge> : null}
                        </span>
                        <Select
                          id={`${fieldId}-in-${input.name}`}
                          value={String(val)}
                          disabled={isSubmitting}
                          onChange={(event) =>
                            setStructuredValues((prev) => ({ ...prev, [input.name]: event.target.value }))
                          }
                        >
                          {input.options.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </Select>
                        {input.description ? (
                          <span className="block font-normal text-muted-foreground">{input.description}</span>
                        ) : null}
                      </label>
                    )
                  }
                  return (
                    <label
                      key={input.name}
                      className="block space-y-1 text-xs font-medium"
                      htmlFor={`${fieldId}-in-${input.name}`}
                    >
                      <span className="flex items-center gap-1.5">
                        <span className="mono">{input.name}</span>
                        {input.required ? <Badge variant="secondary">必填</Badge> : null}
                      </span>
                      <Input
                        id={`${fieldId}-in-${input.name}`}
                        type={input.type === 'number' ? 'number' : 'text'}
                        value={String(val)}
                        disabled={isSubmitting}
                        onChange={(event) =>
                          setStructuredValues((prev) => ({ ...prev, [input.name]: event.target.value }))
                        }
                      />
                      {input.description ? (
                        <span className="block font-normal text-muted-foreground">{input.description}</span>
                      ) : null}
                    </label>
                  )
                })}
              </div>
            </div>
          ) : (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <label className="text-sm font-medium" htmlFor={`${fieldId}-inputs`}>
                  输入参数
                </label>
                {declaredInputs.length > 0 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setUseJsonMode(false)}
                    disabled={isSubmitting}
                  >
                    返回表单模式
                  </Button>
                ) : null}
              </div>
              <Textarea
                id={`${fieldId}-inputs`}
                value={inputsText}
                rows={3}
                disabled={isSubmitting}
                placeholder={'{"target":"web"}'}
                aria-describedby={`${fieldId}-inputs-help`}
                onChange={(event) => setInputsText(event.target.value)}
              />
              <span id={`${fieldId}-inputs-help`} className="block text-xs text-muted-foreground">
                {INPUTS_HELPER}
              </span>
            </div>
          )}

          <label className="block space-y-1.5 text-sm font-medium" htmlFor={`${fieldId}-idempotency`}>
            幂等键
            <Input
              id={`${fieldId}-idempotency`}
              value={idempotencyKey}
              readOnly
              aria-describedby={`${fieldId}-idempotency-help`}
            />
            <span id={`${fieldId}-idempotency-help`} className="block text-xs font-normal text-muted-foreground">
              自动生成。网络超时后可用同一幂等键安全重试。
            </span>
          </label>

          {fieldError ? (
            <p className="field-error" role="alert">
              {fieldError}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" disabled={isSubmitting} onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" disabled={isSubmitting || workflows.length === 0}>
              {isSubmitting ? '触发中…' : '触发运行'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
