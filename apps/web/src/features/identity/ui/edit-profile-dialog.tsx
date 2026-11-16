import { useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@/shared/ui/controls/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/shared/ui/controls/dialog'
import { Input } from '@/shared/ui/controls/input'
import { useToast } from '@/shared/ui/toast'
import { updateProfile, type AuthUser } from '../api/auth-client'
import { sessionQueryOptions } from '../api/queries'
import { UserAvatar } from '@/shared/ui/user-avatar'

const AVATAR_SIZE = 160
const MAX_FILE_BYTES = 10 * 1024 * 1024
const AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp']

async function prepareAvatar(file: File): Promise<string> {
  if (!AVATAR_TYPES.includes(file.type)) throw new Error('请选择 JPG、PNG 或 WebP 图片。')
  if (file.size > MAX_FILE_BYTES) throw new Error('图片不能超过 10 MB。')

  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error('无法读取这张图片，请重新选择。')
  })
  try {
    const canvas = document.createElement('canvas')
    canvas.width = AVATAR_SIZE
    canvas.height = AVATAR_SIZE
    const context = canvas.getContext('2d', { alpha: false })
    if (!context) throw new Error('无法生成头像，请稍后重试。')
    // 等比居中裁切；深浅主题都使用白底合成原图的透明区域。
    const side = Math.min(bitmap.width, bitmap.height)
    context.fillStyle = 'white'
    context.fillRect(0, 0, AVATAR_SIZE, AVATAR_SIZE)
    context.drawImage(
      bitmap,
      (bitmap.width - side) / 2,
      (bitmap.height - side) / 2,
      side,
      side,
      0,
      0,
      AVATAR_SIZE,
      AVATAR_SIZE,
    )
    return canvas.toDataURL('image/jpeg', 0.82)
  } finally {
    bitmap.close()
  }
}

/**
 * 提供个人资料编辑入口，将名称和头像草稿一次保存。
 * @param props.user 当前登录用户，打开时以已保存的资料初始化表单。
 * @returns 编辑按钮、头像预览与保存弹窗。
 */
export function EditProfileDialog({ user }: { user: AuthUser }) {
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const [open, setOpen] = useState(false)
  const [nameDraft, setNameDraft] = useState<string>()
  const [imageDraft, setImageDraft] = useState<string | null>()
  const [isPreparing, setIsPreparing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [avatarError, setAvatarError] = useState('')
  const [error, setError] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  const uploadButton = useRef<HTMLButtonElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const title = useRef<HTMLHeadingElement>(null)
  const name = nameDraft ?? user.name
  const image = imageDraft === undefined ? (user.image ?? null) : imageDraft
  const isBusy = isPreparing || isSaving
  const hasNameChanged = name.trim() !== user.name
  const hasImageChanged = image !== (user.image ?? null)

  const changeOpen = (next: boolean) => {
    if (isBusy) return
    if (next) {
      setNameDraft(undefined)
      setImageDraft(undefined)
      setAvatarError('')
      setError('')
    }
    setOpen(next)
  }

  const selectAvatar = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file || isBusy) return
    setIsPreparing(true)
    setAvatarError('')
    setError('')
    try {
      setImageDraft(await prepareAvatar(file))
    } catch (cause) {
      setAvatarError(cause instanceof Error ? cause.message : '无法处理这张图片，请重新选择。')
    } finally {
      setIsPreparing(false)
    }
  }

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isBusy || (!hasNameChanged && !hasImageChanged)) return
    if (hasNameChanged && !name.trim()) return setError('请填写显示名称。')
    const input = { ...(hasNameChanged && { name: name.trim() }), ...(hasImageChanged && { image }) }
    setError('')
    setIsSaving(true)
    try {
      await updateProfile(input)
      await queryClient.cancelQueries({ queryKey: sessionQueryOptions.queryKey })
      queryClient.setQueryData(sessionQueryOptions.queryKey, (session) =>
        session?.user.id === user.id ? { ...session, user: { ...session.user, ...input } } : session,
      )
      void queryClient.invalidateQueries({ queryKey: sessionQueryOptions.queryKey })
      for (const queryKey of [
        ['identity', 'members'],
        ['collaboration', 'comments'],
        ['projects', 'list'],
        ['requirements', 'detail'],
        ['bugs', 'detail'],
      ]) {
        void queryClient.invalidateQueries({ queryKey })
      }
      setOpen(false)
      showToast('个人资料已保存。', 'success')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败，请稍后重试。')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <Button ref={trigger} variant="outline" className="min-h-11 sm:min-h-9">
          编辑资料
        </Button>
      </DialogTrigger>
      <DialogContent
        aria-describedby={undefined}
        showCloseButton={!isBusy}
        onInteractOutside={(event) => event.preventDefault()}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          title.current?.focus()
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          trigger.current?.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle ref={title} tabIndex={-1}>
            编辑资料
          </DialogTitle>
        </DialogHeader>
        <form className="space-y-5" onSubmit={(event) => void save(event)}>
          <div className="flex flex-wrap items-center gap-4">
            <UserAvatar name={name} image={image} className="size-16 text-xl" />
            <div className="min-w-0 space-y-1.5">
              <div className="flex flex-wrap gap-2">
                <Input
                  ref={fileInput}
                  type="file"
                  aria-label="头像图片"
                  accept={AVATAR_TYPES.join(',')}
                  hidden
                  disabled={isBusy}
                  onChange={(event) => void selectAvatar(event)}
                />
                <Button
                  ref={uploadButton}
                  type="button"
                  variant="outline"
                  className="min-h-11 sm:min-h-9"
                  disabled={isBusy}
                  onClick={() => fileInput.current?.click()}
                >
                  {isPreparing ? '正在处理…' : image ? '更换头像' : '上传头像'}
                </Button>
                {image && (
                  <Button
                    type="button"
                    variant="ghost"
                    className="min-h-11 sm:min-h-9"
                    disabled={isBusy}
                    onClick={() => {
                      setImageDraft(null)
                      setAvatarError('')
                      uploadButton.current?.focus()
                    }}
                  >
                    移除
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">JPG、PNG 或 WebP，最大 10 MB</p>
              {avatarError && (
                <p className="field-error" role="alert">
                  {avatarError}
                </p>
              )}
            </div>
          </div>
          <label className="field">
            显示名称
            <Input
              value={name}
              autoComplete="nickname"
              maxLength={120}
              disabled={isSaving}
              onChange={(event) => setNameDraft(event.target.value)}
            />
          </label>
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={isBusy} onClick={() => changeOpen(false)}>
              取消
            </Button>
            <Button type="submit" disabled={isBusy || (!hasNameChanged && !hasImageChanged)}>
              {isSaving ? '保存中…' : '保存资料'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
