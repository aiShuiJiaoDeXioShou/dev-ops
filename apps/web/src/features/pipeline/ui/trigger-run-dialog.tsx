import { useEffect, useId, useState } from 'react'
import { createIdempotencyKey } from '@dev-ops/api-client'
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/controls/alert'
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
import { Textarea } from '@/shared/ui/controls/textarea'
import type { PipelineRunInputValue, PipelineWorkflowSummary, TriggerRunInput } from '../model/types'

interface TriggerRunDialogProps {
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
}

const INPUTS_HELPER = '可选。按 workflow 声明的 inputs 填写 JSON 对象，例如 {"target":"web"}；留空表示使用默认值。'

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

/**
 * 手动触发运行对话框。
 *
 * 打开时聚焦工作流选择并预生成幂等键；提交失败保留输入，
 * 同一幂等键重试不会创建第二次运行。Esc 关闭后焦点回到触发按钮。
 * @param props 工作流、默认值、提交状态与错误说明。
 * @returns 触发表单对话框；未打开时不渲染内容。
 */
export function TriggerRunDialog({
  open,
  onOpenChange,
  workflows,
  initialWorkflowPath,
  defaultRef,
  onSubmit,
  isSubmitting,
  errorMessage,
}: TriggerRunDialogProps) {
  const fieldId = useId()
  const [workflowPath, setWorkflowPath] = useState(initialWorkflowPath)
  const [ref, setRef] = useState(defaultRef)
  const [inputsText, setInputsText] = useState('')
  const [idempotencyKey, setIdempotencyKey] = useState(() => createIdempotencyKey())
  const [fieldError, setFieldError] = useState<string | null>(null)

  // 每次重新打开都恢复默认值并换一个新的幂等键，避免复用上一次成功提交的键。
  useEffect(() => {
    if (!open) return
    setWorkflowPath(initialWorkflowPath)
    setRef(defaultRef)
    setInputsText('')
    setIdempotencyKey(createIdempotencyKey())
    setFieldError(null)
  }, [open, initialWorkflowPath, defaultRef])

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
    let inputs: Record<string, PipelineRunInputValue>
    try {
      inputs = parseInputsText(inputsText)
    } catch (error) {
      setFieldError(error instanceof Error ? error.message : '输入参数不合法。')
      return
    }
    setFieldError(null)
    onSubmit({ workflowPath, ref: ref.trim(), inputs, idempotencyKey: idempotencyKey.trim() })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
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

          {errorMessage && (
            <Alert variant="destructive">
              <AlertTitle>触发失败</AlertTitle>
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
          )}

          <label className="block space-y-1.5 text-sm font-medium" htmlFor={`${fieldId}-workflow`}>
            工作流
            <Select
              id={`${fieldId}-workflow`}
              value={workflowPath}
              autoFocus
              disabled={isSubmitting}
              onChange={(event) => setWorkflowPath(event.target.value)}
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

          <label className="block space-y-1.5 text-sm font-medium" htmlFor={`${fieldId}-inputs`}>
            输入参数
            <Textarea
              id={`${fieldId}-inputs`}
              value={inputsText}
              rows={4}
              disabled={isSubmitting}
              placeholder={'{"target":"web"}'}
              aria-describedby={`${fieldId}-inputs-help`}
              onChange={(event) => setInputsText(event.target.value)}
            />
            <span id={`${fieldId}-inputs-help`} className="small quiet">
              {INPUTS_HELPER}
            </span>
          </label>

          <label className="block space-y-1.5 text-sm font-medium" htmlFor={`${fieldId}-idempotency`}>
            幂等键
            <Input
              id={`${fieldId}-idempotency`}
              value={idempotencyKey}
              readOnly
              aria-describedby={`${fieldId}-idempotency-help`}
            />
            <span id={`${fieldId}-idempotency-help`} className="small quiet">
              自动生成。网络超时后可用同一幂等键安全重试。
            </span>
          </label>

          {fieldError && (
            <p className="field-error" role="alert">
              {fieldError}
            </p>
          )}

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
