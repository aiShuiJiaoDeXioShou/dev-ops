import { useEffect, useId, useState } from 'react'
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

/** 提交的新建节点入参。 */
export interface CreateNodeFormInput {
  name: string
  capabilities: string[]
}

interface CreateNodeDialogProps {
  /** 是否打开。 */
  open: boolean
  /** 打开状态变化；Esc 关闭后焦点回到触发按钮。 */
  onOpenChange: (open: boolean) => void
  /** 提交创建；调用方负责 mutation，成功后展示一次性令牌。 */
  onSubmit: (input: CreateNodeFormInput) => void
  /** 是否正在提交。 */
  isSubmitting: boolean
  /** 上次提交失败的可读说明。 */
  errorMessage: string | null
}

/**
 * 把逗号或空格分隔的能力标签解析为去重数组。
 * @param text 用户输入。
 * @returns 规范化的标签数组，保持输入顺序。
 */
function parseCapabilities(text: string): string[] {
  const values = text
    .split(/[,，\s]+/)
    .map((item) => item.trim())
    .filter(Boolean)
  return [...new Set(values)]
}

/**
 * 新建执行节点对话框。
 *
 * 填写名称与能力标签后创建节点；创建成功由页面弹出一次性注册令牌。
 * 提交失败保留输入并在表单顶部展示可读错误。
 * @param props 打开状态、提交状态与错误说明。
 * @returns 新建节点表单对话框；未打开时不渲染内容。
 */
export function CreateNodeDialog({ open, onOpenChange, onSubmit, isSubmitting, errorMessage }: CreateNodeDialogProps) {
  const fieldId = useId()
  const [name, setName] = useState('')
  const [capabilitiesText, setCapabilitiesText] = useState('linux, docker')
  const [fieldError, setFieldError] = useState<string | null>(null)

  // 每次打开都重置表单，避免上一次失败输入影响新节点的创建。
  useEffect(() => {
    if (!open) return
    setName('')
    setCapabilitiesText('linux, docker')
    setFieldError(null)
  }, [open])

  const submit = () => {
    const trimmedName = name.trim()
    if (!trimmedName) {
      setFieldError('请填写节点名称。')
      return
    }
    const capabilities = parseCapabilities(capabilitiesText)
    if (capabilities.length === 0) {
      setFieldError('请至少填写一个能力标签，例如 linux。')
      return
    }
    setFieldError(null)
    onSubmit({ name: trimmedName, capabilities })
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
            <DialogTitle>新建执行节点</DialogTitle>
            <DialogDescription>
              注册成功后生成一次性注册令牌，只显示一次。请交给运维同学在节点机器上启动 Agent。
            </DialogDescription>
          </DialogHeader>

          {errorMessage && (
            <Alert variant="destructive">
              <AlertTitle>创建失败</AlertTitle>
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
          )}

          <label className="block space-y-1.5 text-sm font-medium" htmlFor={`${fieldId}-name`}>
            节点名称
            <Input
              id={`${fieldId}-name`}
              value={name}
              autoFocus
              maxLength={80}
              disabled={isSubmitting}
              placeholder="例如 dev-machine-01"
              onChange={(event) => setName(event.target.value)}
            />
          </label>

          <label className="block space-y-1.5 text-sm font-medium" htmlFor={`${fieldId}-capabilities`}>
            能力标签
            <Input
              id={`${fieldId}-capabilities`}
              value={capabilitiesText}
              maxLength={200}
              disabled={isSubmitting}
              placeholder="linux, docker, node24"
              aria-describedby={`${fieldId}-capabilities-help`}
              onChange={(event) => setCapabilitiesText(event.target.value)}
            />
            <span id={`${fieldId}-capabilities-help`} className="small quiet">
              用逗号分隔；标签需在平台白名单内，并与工作流 runs-on 匹配，例如 linux、docker、node24。
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
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? '创建中…' : '创建节点'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
