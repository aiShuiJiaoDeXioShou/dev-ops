import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { isBusinessError } from '@dev-ops/api-client'
import { apiClient } from '@/shared/api/client'
import { DelayedLoading } from '@/shared/ui/delayed-loading'
import { Tag } from '@/shared/ui/tag'
import { useToast } from '@/shared/ui/toast'
import { Button } from '@/shared/ui/controls/button'
import { Select } from '@/shared/ui/controls/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/controls/table'
import { PageError, PageLoading } from '@/shared/ui/page-state'
import { describeRequestError } from '@/shared/api/errors'
import { formatDateTime } from '@/shared/lib/format'
import { teamInvitationsQueryOptions, teamMembersQueryOptions } from '../api/team-queries'
import type { TeamRole } from '../model/session'
import { InviteMemberDialog } from './invite-member-dialog'

const ROLE_LABELS: Record<TeamRole, string> = { admin: '管理员', developer: '开发者', viewer: '浏览者' }

/** 成员与邀请管理；仅管理员页面使用。 */
export function MemberManagement({ teamId, canManage }: { teamId: string; canManage: boolean }) {
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const members = useQuery(teamMembersQueryOptions(teamId))
  const invitations = useQuery(teamInvitationsQueryOptions(teamId))
  const [inviteOpen, setInviteOpen] = useState(false)
  const [error, setError] = useState('')
  const update = useMutation({
    mutationFn: ({ userId, role, status }: { userId: string; role?: TeamRole; status?: 'active' | 'disabled' }) =>
      apiClient.updateTeamMember(teamId, userId, { role, status }),
    onSuccess: async () => {
      setError('')
      await queryClient.invalidateQueries({ queryKey: ['identity', 'members', teamId] })
    },
    onError: (cause: unknown) => {
      const message = isBusinessError(cause) ? describeRequestError(cause).description : '成员更新失败。'
      setError(message)
      showToast(message, 'error')
    },
  })
  const revoke = useMutation({
    mutationFn: (invitationId: string) => apiClient.revokeInvitation(teamId, invitationId),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ['identity', 'invitations', teamId] }),
    onError: (cause: unknown) => {
      const message = isBusinessError(cause) ? describeRequestError(cause).description : '撤销邀请失败。'
      setError(message)
      showToast(message, 'error')
    },
  })
  if (members.isPending)
    return (
      <DelayedLoading pending>
        <PageLoading />
      </DelayedLoading>
    )
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
      <section className="space-y-3">
        <div className="section-heading">
          <h2>成员</h2>
          <span className="spacer" />
          <Button
            type="button"
            className="team-invite-button"
            onClick={() => setInviteOpen(true)}
            disabled={!canManage}
          >
            邀请成员
          </Button>
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>成员</TableHead>
                <TableHead>角色</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>加入时间</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.data.data.map((member) => (
                <TableRow key={member.userId}>
                  <TableCell>
                    <p className="font-medium">{member.name}</p>
                    <p className="text-xs text-muted-foreground">{member.email}</p>
                  </TableCell>
                  <TableCell>
                    <Select
                      aria-label={`${member.name} 角色`}
                      value={member.role}
                      disabled={!canManage}
                      onChange={(event) =>
                        update.mutate({ userId: member.userId, role: event.target.value as TeamRole })
                      }
                    >
                      {Object.entries(ROLE_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Tag variant={member.status === 'active' ? 'green' : 'red'}>
                      {member.status === 'active' ? '正常' : '已停用'}
                    </Tag>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{formatDateTime(member.joinedAt)}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={!canManage}
                      onClick={() =>
                        update.mutate({
                          userId: member.userId,
                          status: member.status === 'active' ? 'disabled' : 'active',
                        })
                      }
                    >
                      {member.status === 'active' ? '停用' : '恢复'}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">待接受邀请</h2>
        {invitations.isPending ? (
          <DelayedLoading pending>
            <PageLoading />
          </DelayedLoading>
        ) : invitations.data?.data.length ? (
          <div className="rounded-xl border bg-card">
            <Table>
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
          <p className="text-sm text-muted-foreground">暂无待接受邀请。</p>
        )}
      </section>
      <InviteMemberDialog teamId={teamId} open={inviteOpen} onOpenChange={setInviteOpen} />
    </div>
  )
}
