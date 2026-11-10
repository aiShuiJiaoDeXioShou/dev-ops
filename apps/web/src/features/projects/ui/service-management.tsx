import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/shared/api/client'
import { describeRequestError } from '@/shared/api/errors'
import { useSession } from '@/features/identity/public'
import { Button } from '@/shared/ui/controls/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/controls/dialog'
import { Input } from '@/shared/ui/controls/input'
import { Textarea } from '@/shared/ui/controls/textarea'
import { useToast } from '@/shared/ui/toast'
import { projectServicesQueryOptions } from '../api/queries'

/** 项目服务目录管理；管理员/开发者可创建与停用，浏览者只读。 */
export function ServiceManagement({ projectId }: { projectId: string }) {
  const { role } = useSession()
  const canManage = role === 'admin' || role === 'developer'
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const services = useQuery(projectServicesQueryOptions(projectId))
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const create = useMutation({
    mutationFn: () =>
      apiClient.createProjectService(projectId, { name: name.trim(), description: description.trim() || null }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['projects', 'services', projectId] })
      setOpen(false)
      setName('')
      setDescription('')
      showToast('服务已创建。', 'success')
    },
    onError: (error: unknown) => showToast(describeRequestError(error).description, 'error'),
  })
  const toggle = useMutation({
    mutationFn: (input: { id: string; version: number; status: 'active' | 'disabled' }) =>
      apiClient.updateProjectService(projectId, input.id, { version: input.version, status: input.status }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['projects', 'services', projectId] })
    },
    onError: (error: unknown) => showToast(describeRequestError(error).description, 'error'),
  })
  if (services.isPending) return <p className="muted">服务加载中…</p>
  if (services.isError) return <p className="muted">服务加载失败，请重试。</p>
  return (
    <section aria-label="项目服务">
      <div className="row spread">
        <h3 className="settings-section-title">项目服务</h3>
        {canManage ? (
          <Button type="button" size="sm" onClick={() => setOpen(true)}>
            新增服务
          </Button>
        ) : null}
      </div>
      {services.data.data.length === 0 ? (
        <p className="muted">尚无服务；未配置服务时仍可进行项目级构建上报。</p>
      ) : (
        <ul className="plain-list">
          {services.data.data.map((service) => (
            <li key={service.id}>
              <span>{service.name}</span>
              <span className="muted">
                {service.repositories.map((repository) => repository.name).join('、') || '未关联仓库'}
              </span>
              <span className="tag">{service.status === 'active' ? '启用' : '已停用'}</span>
              {canManage ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={toggle.isPending}
                  onClick={() =>
                    toggle.mutate({
                      id: service.id,
                      version: service.version,
                      status: service.status === 'active' ? 'disabled' : 'active',
                    })
                  }
                >
                  {service.status === 'active' ? '停用' : '启用'}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              if (!name.trim()) return showToast('请填写服务名称。', 'error')
              create.mutate()
            }}
          >
            <DialogHeader>
              <DialogTitle>新增项目服务</DialogTitle>
            </DialogHeader>
            <label className="block space-y-1.5 text-sm font-medium">
              服务名称
              <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} autoFocus />
            </label>
            <label className="block space-y-1.5 text-sm font-medium">
              说明
              <Textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={2000} />
            </label>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                取消
              </Button>
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? '保存中…' : '保存'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  )
}
