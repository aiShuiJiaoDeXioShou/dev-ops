import { useId, useState, type FormEvent } from 'react'
import { createIdempotencyKey } from '@dev-ops/api-client'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { skillChoicesOptions } from '@/features/knowledge/api/queries'
import { teamMembersQueryOptions } from '@/features/identity/api/team-queries'
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
import { Button } from '@/shared/ui/controls/button'
import { Checkbox } from '@/shared/ui/controls/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFormBody,
  DialogFormFooter,
  DialogFormHeader,
  DialogTitle,
} from '@/shared/ui/controls/dialog'
import { Input } from '@/shared/ui/controls/input'
import { Select } from '@/shared/ui/controls/select'
import { Textarea } from '@/shared/ui/controls/textarea'
import { useToast } from '@/shared/ui/toast'
import { botQueryKey, type BotView } from '../api/queries'
import { useBotModelSelection } from '../model/use-bot-model-selection'
import { BotModelFields } from './bot-model-fields'

interface BotFormProps {
  teamId: string
  bot?: BotView
  defaultOwnerId: string
  canBindModel?: boolean
  inline?: boolean
  onClose: () => void
}

/**
 * 创建或编辑 Bot。调用方在打开编辑器时挂载，关闭后重新初始化草稿。
 * @param props 团队、负责人、待编辑 Bot、模型绑定权限、是否内嵌到侧栏及关闭回调。
 * @returns 复用校验与保存逻辑的侧栏表单或弹窗，失败保留草稿。
 */
export function BotForm({ teamId, bot, defaultOwnerId, canBindModel = false, inline = false, onClose }: BotFormProps) {
  const id = useId()
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const members = useQuery(teamMembersQueryOptions(teamId))
  const defaultOwner = bot?.ownerUserId ?? defaultOwnerId
  const skillCatalog = useInfiniteQuery(skillChoicesOptions(teamId))
  const [selectedSkills, setSelectedSkills] = useState(bot?.skillIds ?? [])
  const changedSkills =
    selectedSkills.length !== (bot?.skillIds.length ?? 0) || selectedSkills.some((id) => !bot?.skillIds.includes(id))
  const skills = skillCatalog.data?.pages.flatMap(({ data }) => data.items) ?? []
  const selectableSkills = skills.filter((skill) => skill.enabled || selectedSkills.includes(skill.id))

  const [discardOpen, setDiscardOpen] = useState(false)
  const [name, setName] = useState(bot?.name ?? '')
  const [responsibility, setResponsibility] = useState(bot?.responsibility ?? '')
  const [instructions, setInstructions] = useState(bot?.instructions ?? '')
  const [ownerUserId, setOwnerUserId] = useState(defaultOwner)
  const owners = members.data?.data.filter((member) => member.status === 'active') ?? []
  const selectedOwnerActive = owners.some((member) => member.userId === ownerUserId)
  const canSelectModel = !bot && canBindModel
  const modelSelection = useBotModelSelection(teamId, canSelectModel)
  const canSave =
    selectedOwnerActive &&
    !!name.trim() &&
    !!responsibility.trim() &&
    (!modelSelection.connectionId || !!modelSelection.binding)
  const mutation = useMutation({
    mutationFn: () => {
      const input = {
        name: name.trim(),
        responsibility: responsibility.trim(),
        instructions,
        ownerUserId,
        ...(changedSkills ? { skillIds: selectedSkills } : {}),
      }
      const options = { idempotencyKey: createIdempotencyKey() }
      return bot
        ? apiClient.updateBot(bot.id, { ...input, configVersion: bot.configVersion }, options)
        : apiClient.createBot(teamId, { ...input, modelBinding: modelSelection.binding }, options)
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: botQueryKey })
      showToast(bot ? '智能体已保存' : '智能体已创建', 'success')
      onClose()
    },
  })
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!mutation.isPending && canSave) mutation.mutate()
  }
  const hasEdits =
    name !== (bot?.name ?? '') ||
    responsibility !== (bot?.responsibility ?? '') ||
    instructions !== (bot?.instructions ?? '') ||
    ownerUserId !== defaultOwner ||
    !!modelSelection.connectionId ||
    changedSkills

  function close() {
    if (mutation.isPending) return
    if (hasEdits) setDiscardOpen(true)
    else onClose()
  }

  const Body = inline ? 'div' : DialogFormBody
  const Footer = inline ? 'div' : DialogFormFooter
  const form = (
    <form
      data-settings-dirty={(inline && hasEdits) || undefined}
      data-settings-pending={(inline && mutation.isPending) || undefined}
      className={inline ? 'grid gap-4' : 'flex min-h-0 flex-col'}
      onSubmit={save}
    >
      <Body>
        <div className={inline ? 'grid gap-3' : 'form-grid'}>
          <label className="field" htmlFor={`${id}-name`}>
            <span>名称</span>
            <Input
              id={`${id}-name`}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="给你的协作者起个名字"
              maxLength={60}
              required
            />
          </label>
          <label className="field" htmlFor={`${id}-responsibility`}>
            <span>职责</span>
            <Input
              id={`${id}-responsibility`}
              value={responsibility}
              onChange={(event) => setResponsibility(event.target.value)}
              maxLength={4000}
              placeholder="例如：产品助手"
              required
            />
          </label>
          <label className="field" htmlFor={`${id}-owner`}>
            <span>负责人</span>
            <Select
              id={`${id}-owner`}
              value={ownerUserId}
              onChange={(event) => setOwnerUserId(event.target.value)}
              disabled={members.isPending || members.isError}
              required
            >
              {!selectedOwnerActive && (
                <option value={ownerUserId}>{members.isPending ? '正在加载成员…' : '请选择有效成员'}</option>
              )}
              {owners.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {member.name}
                </option>
              ))}
            </Select>
          </label>
          {members.isError && (
            <Button type="button" variant="outline" onClick={() => void members.refetch()}>
              重试加载成员
            </Button>
          )}
          <div className="field">
            <span>运行环境</span>
            <span className="runtime-cell">团队执行器</span>
          </div>
          {canSelectModel && <BotModelFields selection={modelSelection} isOptional isSaving={mutation.isPending} />}
          <label className="field full" htmlFor={`${id}-instructions`}>
            <span>职责说明</span>
            <Textarea
              id={`${id}-instructions`}
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
              placeholder="描述长期职责、工作方式与输出要求"
              maxLength={16000}
              rows={5}
            />
          </label>
          <fieldset className="field full">
            <legend>Skills</legend>
            {skillCatalog.isPending && <p className="small muted">正在加载技能…</p>}
            {skillCatalog.isError && (
              <Button type="button" variant="outline" onClick={() => void skillCatalog.refetch()}>
                重试加载技能
              </Button>
            )}
            {skillCatalog.isSuccess && !selectableSkills.length && <p className="small muted">暂无已启用的技能</p>}
            <div className="work-checks">
              {selectableSkills.map((skill) => (
                <label className="row" key={skill.id}>
                  <Checkbox
                    checked={selectedSkills.includes(skill.id)}
                    onCheckedChange={(checked) => {
                      setSelectedSkills((previous) =>
                        checked === true ? [...previous, skill.id] : previous.filter((id) => id !== skill.id),
                      )
                    }}
                  />
                  <span>
                    {skill.name}
                    {!skill.enabled && '（已停用）'}
                  </span>
                </label>
              ))}
            </div>
            {skillCatalog.hasNextPage && (
              <Button
                type="button"
                variant="ghost"
                disabled={skillCatalog.isFetchingNextPage}
                onClick={() => void skillCatalog.fetchNextPage()}
              >
                加载更多技能
              </Button>
            )}
          </fieldset>
          {mutation.error && (
            <p role="alert" className="text-sm text-destructive">
              {describeRequestError(mutation.error).description}
            </p>
          )}
        </div>
      </Body>
      <Footer className={inline ? 'row justify-end' : undefined}>
        <Button type="button" variant="outline" disabled={mutation.isPending} onClick={close}>
          取消
        </Button>
        <Button type="submit" disabled={mutation.isPending || !canSave}>
          {mutation.isPending ? '正在保存…' : bot ? '保存配置' : '创建智能体'}
        </Button>
      </Footer>
    </form>
  )
  const discardDialog = (
    <AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>放弃编辑？</AlertDialogTitle>
          <AlertDialogDescription>关闭会清除这次尚未保存的智能体配置。</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>继续编辑</AlertDialogCancel>
          <AlertDialogAction onClick={onClose}>放弃修改</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
  if (inline)
    return (
      <div className="grid gap-3">
        {form}
        {discardDialog}
      </div>
    )
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close()
      }}
    >
      <DialogContent layout="form">
        <DialogFormHeader>
          <DialogTitle>{bot ? '编辑智能体' : '创建智能体'}</DialogTitle>
          <DialogDescription className="sr-only">设置智能体的职责、负责人和运行指令。</DialogDescription>
        </DialogFormHeader>
        {form}
        {discardDialog}
      </DialogContent>
    </Dialog>
  )
}
