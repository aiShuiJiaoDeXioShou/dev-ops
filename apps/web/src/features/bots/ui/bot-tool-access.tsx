import { useEffect, useRef, useState } from 'react'
import { createIdempotencyKey } from '@dev-ops/api-client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/shared/api/client'
import { describeRequestError } from '@/shared/api/errors'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/ui/controls/alert-dialog'
import { Button, buttonVariants } from '@/shared/ui/controls/button'
import { Select } from '@/shared/ui/controls/select'
import { Tag } from '@/shared/ui/tag'
import { botDetailQueryOptions, botQueryKey } from '../api/queries'

type AccessMode = 'sandbox' | 'full'

const MODE_LABEL: Record<AccessMode, string> = { sandbox: '沙盒', full: '完全访问' }
const MODE_HINT: Record<AccessMode, string> = {
  sandbox: '文件与命令工具仅可访问该智能体的独立工作目录。',
  full: '允许工具访问执行主机上的其他目录。',
}

function isAccessMode(value: string): value is AccessMode {
  return value === 'sandbox' || value === 'full'
}

/**
 * 展示并修改一位智能体的本地工具权限；切换前二次确认，因为保存会停止它正在进行的运行。
 * @param props 智能体标识、名称与当前成员是否可修改。
 * @returns 可写成员看到选择框与确认流程，只读成员看到当前模式；保存失败保留原值并可重试。
 */
export function BotToolAccess({ botId, name, canWrite }: { botId: string; name: string; canWrite: boolean }) {
  const client = useQueryClient()
  const query = useQuery(botDetailQueryOptions(botId))
  const [pendingMode, setPendingMode] = useState<AccessMode>()
  const fieldRef = useRef<HTMLDivElement>(null)
  const selectRef = useRef<HTMLSelectElement>(null)
  const bot = query.data?.data
  const current: AccessMode = bot?.accessMode ?? 'sandbox'
  const save = useMutation({
    mutationFn: (accessMode: AccessMode) => {
      if (!bot) throw new Error('智能体配置尚未加载')
      return apiClient.setBotAccess(
        botId,
        { configVersion: bot.configVersion, accessMode },
        { idempotencyKey: createIdempotencyKey() },
      )
    },
    onSuccess: async (result) => {
      client.setQueryData(botDetailQueryOptions(botId).queryKey, result)
      await client.invalidateQueries({ queryKey: botQueryKey })
    },
    onError: () => client.invalidateQueries({ queryKey: botDetailQueryOptions(botId).queryKey }),
  })
  useEffect(() => {
    if (!save.isPending && document.activeElement === fieldRef.current) selectRef.current?.focus()
  }, [save.isPending])
  if (query.isError)
    return (
      <div className="grid gap-2">
        <p className="field-error" role="alert">
          {describeRequestError(query.error).description}
        </p>
        <Button type="button" size="sm" variant="outline" onClick={() => void query.refetch()}>
          重试加载权限
        </Button>
      </div>
    )
  if (!canWrite)
    return (
      <div className="grid gap-1">
        <span>{MODE_LABEL[current]}</span>
        <span className="small quiet">{MODE_HINT[current]}</span>
      </div>
    )
  return (
    <div ref={fieldRef} className="grid gap-1" tabIndex={-1}>
      <div className="row gap-2">
        <Select
          ref={selectRef}
          aria-label={`${name}的工具访问权限`}
          value={current}
          disabled={!bot || save.isPending}
          onChange={(event) => {
            const mode = event.target.value
            if (isAccessMode(mode) && mode !== current) setPendingMode(mode)
          }}
        >
          <option value="sandbox">沙盒 · 仅工作目录</option>
          <option value="full">完全访问</option>
        </Select>
        {current === 'full' && <Tag variant="red">高风险</Tag>}
      </div>
      <span className="small quiet">{MODE_HINT[current]}</span>
      {save.isPending && (
        <span className="small quiet" role="status">
          正在保存权限…
        </span>
      )}
      {save.isError && (
        <p className="field-error" role="alert">
          {describeRequestError(save.error).description}
        </p>
      )}
      <AlertDialog
        open={Boolean(pendingMode)}
        onOpenChange={(open) => {
          if (!open) setPendingMode(undefined)
        }}
      >
        <AlertDialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            // 保存中选择框暂时禁用，先让焦点停在同一个字段。
            if (selectRef.current?.disabled) fieldRef.current?.focus()
            else selectRef.current?.focus()
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingMode === 'full' ? `允许「${name}」完全访问执行主机？` : `将「${name}」切换为沙盒？`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingMode === 'full'
                ? '文件与命令工具将不再限于它的工作目录，可以读取和修改执行主机上的其他文件。'
                : '文件与命令工具将只能访问它的独立工作目录。'}
              它正在进行的运行会被停止，之后的运行使用新权限。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className={pendingMode === 'full' ? buttonVariants({ variant: 'destructive' }) : undefined}
              onClick={() => {
                if (pendingMode) save.mutate(pendingMode)
              }}
            >
              {pendingMode === 'full' ? '允许完全访问' : '切换为沙盒'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
