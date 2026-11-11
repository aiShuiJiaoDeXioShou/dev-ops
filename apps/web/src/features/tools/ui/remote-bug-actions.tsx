import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/shared/api/client'
import { describeRequestError } from '@/shared/api/errors'
import { projectRepositoriesQueryOptions } from '@/features/code/public'
import { Button } from '@/shared/ui/controls/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/controls/dialog'
import { FormField } from '@/shared/ui/controls/form-field'
import { Input } from '@/shared/ui/controls/input'
import { Select } from '@/shared/ui/controls/select'
import { Textarea } from '@/shared/ui/controls/textarea'
import { useToast } from '@/shared/ui/toast'
import { toolCapabilitiesQueryOptions } from '../api/queries'

/**
 * 缺陷详情的远端写动作：创建远端 Issue 并关联本地 Bug、添加本地或远端评论。
 * @param props 项目/缺陷标识与写权限标记。
 * @returns 两个按能力显示的按钮；未授权时不渲染入口。
 */
export function RemoteBugActions({
  projectId,
  bugId,
  canWrite,
}: {
  projectId: string
  bugId: string
  canWrite: boolean
}) {
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const capabilities = useQuery(toolCapabilitiesQueryOptions(projectId))
  const repositories = useQuery(projectRepositoriesQueryOptions(projectId))
  const [issueOpen, setIssueOpen] = useState(false)
  const [commentOpen, setCommentOpen] = useState(false)
  const [repositoryId, setRepositoryId] = useState('')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [remoteNumber, setRemoteNumber] = useState('')
  const [commentTarget, setCommentTarget] = useState<'bug' | 'remote_issue' | 'remote_pull_request'>('bug')

  const granted = new Set(
    (capabilities.data?.data.capabilities ?? []).filter((item) => item.granted).map((item) => item.capability),
  )
  const canCreateIssue = canWrite && granted.has('create_issue')
  const canComment = granted.has('add_comment')
  const repositoryItems = repositories.data?.data ?? []

  const createIssue = useMutation({
    mutationFn: () =>
      apiClient.createRemoteIssue(projectId, {
        repositoryId,
        bugId,
        title,
        body,
      }),
    onSuccess: async () => {
      setIssueOpen(false)
      setTitle('')
      setBody('')
      await queryClient.invalidateQueries({ queryKey: ['bugs'] })
      showToast('远端 Issue 已创建并关联', 'success')
    },
    onError: (error: unknown) => showToast(describeRequestError(error).description, 'error'),
  })

  const addComment = useMutation({
    mutationFn: () =>
      apiClient.addToolComment(projectId, {
        targetType: commentTarget,
        ...(commentTarget === 'bug' ? { targetId: bugId } : {}),
        ...(commentTarget !== 'bug' ? { repositoryId, remoteNumber: Number(remoteNumber) } : {}),
        body,
      }),
    onSuccess: async () => {
      setCommentOpen(false)
      setBody('')
      setRemoteNumber('')
      await queryClient.invalidateQueries({ queryKey: ['bugs'] })
      showToast('评论已提交', 'success')
    },
    onError: (error: unknown) => showToast(describeRequestError(error).description, 'error'),
  })

  return (
    <>
      {canCreateIssue ? (
        <Button size="sm" variant="outline" onClick={() => setIssueOpen(true)}>
          创建远端 Issue
        </Button>
      ) : null}
      {canComment ? (
        <Button size="sm" variant="outline" onClick={() => setCommentOpen(true)}>
          添加评论
        </Button>
      ) : null}

      <Dialog open={issueOpen} onOpenChange={setIssueOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>创建远端 Issue</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <FormField label="仓库" required>
              <Select value={repositoryId} onChange={(event) => setRepositoryId(event.target.value)}>
                <option value="">请选择仓库</option>
                {repositoryItems.map((repository) => (
                  <option key={repository.id} value={repository.id}>
                    {repository.namespace}/{repository.name}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="标题" required>
              <Input value={title} onChange={(event) => setTitle(event.target.value)} />
            </FormField>
            <FormField label="正文">
              <Textarea value={body} onChange={(event) => setBody(event.target.value)} rows={6} />
            </FormField>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setIssueOpen(false)}>
              取消
            </Button>
            <Button
              type="button"
              onClick={() => createIssue.mutate()}
              disabled={createIssue.isPending || !repositoryId || title.trim().length === 0}
            >
              {createIssue.isPending ? '提交中…' : '创建并关联'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={commentOpen} onOpenChange={setCommentOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>添加评论</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <FormField label="评论目标" required>
              <Select value={commentTarget} onChange={(event) => setCommentTarget(event.target.value as 'bug')}>
                <option value="bug">本地缺陷讨论</option>
                <option value="remote_issue">远端 Issue</option>
                <option value="remote_pull_request">远端 PR</option>
              </Select>
            </FormField>
            {commentTarget !== 'bug' ? (
              <>
                <FormField label="仓库" required>
                  <Select value={repositoryId} onChange={(event) => setRepositoryId(event.target.value)}>
                    <option value="">请选择仓库</option>
                    {repositoryItems.map((repository) => (
                      <option key={repository.id} value={repository.id}>
                        {repository.namespace}/{repository.name}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField label="远端编号" required>
                  <Input
                    value={remoteNumber}
                    onChange={(event) => setRemoteNumber(event.target.value)}
                    inputMode="numeric"
                  />
                </FormField>
              </>
            ) : null}
            <FormField label="正文" required>
              <Textarea value={body} onChange={(event) => setBody(event.target.value)} rows={6} />
            </FormField>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setCommentOpen(false)}>
              取消
            </Button>
            <Button
              type="button"
              onClick={() => addComment.mutate()}
              disabled={
                addComment.isPending ||
                body.trim().length === 0 ||
                (commentTarget !== 'bug' && (!repositoryId || !remoteNumber))
              }
            >
              {addComment.isPending ? '提交中…' : '提交评论'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
