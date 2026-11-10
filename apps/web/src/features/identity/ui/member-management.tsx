import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { isBusinessError } from '@dev-ops/api-client'
import { apiClient } from '@/shared/api/client'
import { describeRequestError } from '@/shared/api/errors'
import { formatDateTime } from '@/shared/lib/format'
import { Button } from '@/shared/ui/controls/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/controls/dialog'
import { Select } from '@/shared/ui/controls/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/controls/table'
import { DelayedLoading } from '@/shared/ui/delayed-loading'
import { PageError, PageLoading } from '@/shared/ui/page-state'
import { useToast } from '@/shared/ui/toast'
import { teamInvitationsQueryOptions, teamMembersQueryOptions } from '../api/team-queries'
import { useSession, type TeamRole } from '../model/session'

const ROLE_LABELS: Record<TeamRole, string> = { admin: '管理员', developer: '开发者', viewer: '浏览者' }
type MemberStatus = 'active' | 'disabled'
interface TeamMember {
  userId: string
  name: string
  email: string
  role: TeamRole
  status: string
  joinedAt: string
}

/** 成员角色与状态管理弹窗，保存期间禁用重复提交。 */
function ManageMemberDialog({
  member,
  open,
  canManage,
  pending,
  error,
  onOpenChange,
  onSave,
}: {
  member: TeamMember | null
  open: boolean
  canManage: boolean
  pending: boolean
  error: string
  onOpenChange: (open: boolean) => void
  onSave: (role: TeamRole, status: MemberStatus) => void
}) {
  const [role, setRole] = useState<TeamRole>('developer')
  const [status, setStatus] = useState<MemberStatus>('active')
  useEffect(() => {
    if (!open || !member) return
    setRole(member.role)
    setStatus(member.status === 'disabled' ? 'disabled' : 'active')
  }, [member, open])
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>管理成员{member ? ` ${member.name}` : ''}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            onSave(role, status)
          }}
        >
          <label className="block space-y-1.5 text-sm font-medium">
            角色
            <Select
              value={role}
              disabled={!canManage || pending}
              onChange={(event) => setRole(event.target.value as TeamRole)}
            >
              {Object.entries(ROLE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </label>
          <label className="block space-y-1.5 text-sm font-medium">
            状态
            <Select
              value={status}
              disabled={!canManage || pending}
              onChange={(event) => setStatus(event.target.value as MemberStatus)}
            >
              <option value="active">正常</option>
              <option value="disabled">已停用</option>
            </Select>
          </label>
          {error && (
            <p role="alert" className="field-error">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" disabled={!canManage || pending}>
              {pending ? '保存中…' : '保存成员'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** 成员与邀请管理：列表展示成员角色、状态，并提供管理员管理入口。 */
export function MemberManagement({ teamId, canManage }: { teamId: string; canManage: boolean }) {
  const { user } = useSession()
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const members = useQuery(teamMembersQueryOptions(teamId))
  const invitations = useQuery(teamInvitationsQueryOptions(teamId))
  const [manageTarget, setManageTarget] = useState<TeamMember | null>(null)
  const [error, setError] = useState('')
  const update = useMutation({
    mutationFn: ({ userId, role, status }: { userId: string; role: TeamRole; status: MemberStatus }) =>
      apiClient.updateTeamMember(teamId, userId, { role, status }),
    onSuccess: async () => {
      setError('')
      setManageTarget(null)
      await queryClient.invalidateQueries({ queryKey: ['identity', 'members', teamId] })
      showToast('成员信息已更新。', 'success')
    },
    onError: (cause: unknown) => {
      const message = isBusinessError(cause) ? describeRequestError(cause).description : '成员更新失败。'
      setError(message)
    },
  })
  const revoke = useMutation({
    mutationFn: (invitationId: string) => apiClient.revokeInvitation(teamId, invitationId),
    onSuccess: async () => {
      setError('')
      await queryClient.invalidateQueries({ queryKey: ['identity', 'invitations', teamId] })
      showToast('邀请已撤销。', 'success')
    },
    onError: (cause: unknown) => {
      const message = isBusinessError(cause) ? describeRequestError(cause).description : '撤销邀请失败。'
      setError(message)
      showToast(message, 'error')
    },
  })
  if (members.isPending) {
    return (
      <DelayedLoading pending>
        <PageLoading message="成员加载中…" />
      </DelayedLoading>
    )
  }
  if (members.isError) {
    const described = describeRequestError(members.error)
    return (
      <PageError
        title="成员加载失败"
        description={described.description}
        requestId={described.requestId}
        onRetry={() => void members.refetch()}
      />
    )
  }
  return (
    <div className="team-admin-content">
      <section>
        <div className="section-heading">
          <h2>成员与权限</h2>
        </div>
        {error && !manageTarget && (
          <p role="alert" className="field-error">
            {error}
          </p>
        )}
        <div className="table-wrap">
          <Table className="table">
            <TableHeader>
              <TableRow>
                <TableHead>成员</TableHead>
                <TableHead>邮箱</TableHead>
                <TableHead>角色</TableHead>
                <TableHead>状态</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.data.data.map((member) => (
                <TableRow key={member.userId}>
                  <TableCell>
                    <span className="item-cell">
                      <span className="avatar">{member.name.slice(0, 1)}</span>
                      <strong>{member.name}</strong>
                      {member.userId === user?.id && <span className="badge">我</span>}
                    </span>
                  </TableCell>
                  <TableCell>{member.email}</TableCell>
                  <TableCell>{ROLE_LABELS[member.role]}</TableCell>
                  <TableCell>
                    <span className="status">
                      <span className={member.status === 'active' ? 'dot green' : 'dot'} />
                      {member.status === 'active' ? '正常' : '已停用'}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={!canManage}
                      onClick={() => {
                        setError('')
                        setManageTarget(member)
                      }}
                    >
                      管理
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>
      <section>
        <div className="section-heading">
          <h2>待接受邀请</h2>
        </div>
        {invitations.isPending ? (
          <DelayedLoading pending>
            <PageLoading message="邀请加载中…" />
          </DelayedLoading>
        ) : invitations.data?.data.length ? (
          <div className="table-wrap">
            <Table className="table">
              <TableHeader>
                <TableRow>
                  <TableHead>邮箱</TableHead>
                  <TableHead>角色</TableHead>
                  <TableHead>过期时间</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invitations.data.data.map((invitation) => (
                  <TableRow key={invitation.id}>
                    <TableCell>{invitation.email}</TableCell>
                    <TableCell>{ROLE_LABELS[invitation.role]}</TableCell>
                    <TableCell className="text-muted-foreground">{formatDateTime(invitation.expiresAt)}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={!canManage || revoke.isPending}
                        onClick={() => revoke.mutate(invitation.id)}
                      >
                        撤销
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <p className="section-note">暂无待接受邀请。</p>
        )}
      </section>
      <ManageMemberDialog
        member={manageTarget}
        open={manageTarget !== null}
        canManage={canManage}
        pending={update.isPending}
        error={manageTarget ? error : ''}
        onOpenChange={(open) => {
          if (!open) {
            setManageTarget(null)
            setError('')
          }
        }}
        onSave={(role, status) => {
          if (!manageTarget) return
          update.mutate({ userId: manageTarget.userId, role, status })
        }}
      />
    </div>
  )
}
