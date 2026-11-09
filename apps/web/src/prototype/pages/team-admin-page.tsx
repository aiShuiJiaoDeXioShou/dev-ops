import { useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router'
import {
  ProtoButton,
  ProtoEmpty,
  ProtoField,
  ProtoSectionHeading,
  ProtoWorkPageHead,
} from '@/prototype/components/proto-controls'
import { ProtoAvatar, ProtoStatus } from '@/prototype/components/proto'
import { PrototypeDialog } from '@/prototype/components/prototype-dialog'
import { PrototypeIcon } from '@/prototype/icons/icon'
import { usePrototype } from '@/prototype/data/store'
import type { TeamRole } from '@/prototype/data/types'
import {
  checkMemberChange,
  createTeamAdminWorkspace,
  inviteMember,
  isTeamRole,
  revokeInvitation,
  teamRoleOptions,
  updateMember,
} from '@/prototype/data/team-admin'
import type { TeamAdminWorkspace, TeamInvitation, TeamMember, TeamMemberStatus } from '@/prototype/data/team-admin'

/** 成员邮箱的本地校验规则；原型不发送邀请邮件。 */
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * 渲染团队管理页面，并在页面内再次校验管理员角色。
 * @returns 非管理员看到权限说明；管理员看到团队资料、成员与邀请管理。
 */
export function TeamAdminPage() {
  const { currentRole, currentTeam } = usePrototype()
  const [workspaces, setWorkspaces] = useState<Record<string, TeamAdminWorkspace>>({})

  const saveWorkspace = (teamId: string, next: TeamAdminWorkspace) => {
    setWorkspaces((current) => ({ ...current, [teamId]: next }))
  }

  if (currentRole !== '管理员') {
    return <TeamAdminDenied role={currentRole} teamName={currentTeam.name} />
  }
  return <TeamAdminContent key={currentTeam.id} workspaces={workspaces} onSaveWorkspace={saveWorkspace} />
}

/**
 * 渲染管理员可见的团队管理内容：团队资料、成员表与邀请表。
 * @param props.workspaces 按团队保存的本地工作区；props.onSaveWorkspace 写回指定团队工作区。
 * @returns 与原型 work-padding/team-admin 结构一致的团队管理主体；成员与邀请变更只写入本地演示数据。
 */
function TeamAdminContent({
  workspaces,
  onSaveWorkspace,
}: {
  workspaces: Record<string, TeamAdminWorkspace>
  onSaveWorkspace: (teamId: string, next: TeamAdminWorkspace) => void
}) {
  const { currentTeam, currentRole: _currentRole, setCurrentRole, updateTeam, showToast } = usePrototype()
  const [memberError, setMemberError] = useState('')
  const [inviteOpen, setInviteOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [manageMember, setManageMember] = useState<TeamMember | null>(null)

  const workspace = workspaces[currentTeam.id] ?? createTeamAdminWorkspace(currentTeam.id)
  const existingEmails = [
    ...workspace.members.map((member) => member.email),
    ...workspace.invitations.map((invitation) => invitation.email),
  ]

  const saveWorkspace = (next: TeamAdminWorkspace) => {
    onSaveWorkspace(currentTeam.id, next)
  }

  const handleInvite = (email: string, role: TeamRole) => {
    saveWorkspace(inviteMember(workspace, email, role))
    setInviteOpen(false)
    showToast(`已创建邀请：${email}（本地演示，未发送邮件）`)
  }

  const handleRevoke = (invitation: TeamInvitation) => {
    saveWorkspace(revokeInvitation(workspace, invitation.id))
    showToast(`已撤销邀请：${invitation.email}（本地演示）`)
  }

  const handleAccept = (invitation: TeamInvitation) => {
    saveWorkspace({
      ...workspace,
      members: [
        ...workspace.members,
        {
          id: `member-${Date.now()}`,
          name: invitation.email.split('@')[0] ?? invitation.email,
          email: invitation.email,
          role: invitation.role,
          status: '正常',
          joinedAt: '刚刚',
          isCurrentUser: false,
        },
      ],
      invitations: workspace.invitations.filter((item) => item.id !== invitation.id),
    })
    showToast(`已模拟加入：${invitation.email}（本地演示）`)
  }

  const saveMember = (member: TeamMember, role: TeamRole, status: TeamMemberStatus) => {
    const check = checkMemberChange(workspace.members, member.id, { role, status })
    if (!check.allowed) {
      setMemberError(check.reason)
      return
    }
    setMemberError('')
    saveWorkspace(updateMember(workspace, member.id, { role, status }))
    if (member.isCurrentUser) setCurrentRole(status === '正常' ? role : '浏览者')
    setManageMember(null)
    showToast(`已更新 ${member.name} 的角色与状态（本地演示）`)
  }

  return (
    <>
      <ProtoWorkPageHead
        title="团队管理"
        actions={
          <>
            <ProtoButton onClick={() => setInviteOpen(true)}>
              <PrototypeIcon name="plus" />
              邀请成员
            </ProtoButton>
            <ProtoButton onClick={() => setProfileOpen(true)}>编辑团队</ProtoButton>
          </>
        }
      />

      <div className="work-padding team-admin">
        <section className="team-profile" aria-label="团队资料">
          <div className="team-token active" aria-hidden="true">
            <span>{currentTeam.initial}</span>
          </div>
          <div>
            <h2>{currentTeam.name}</h2>
          </div>
        </section>

        <ProtoSectionHeading title="成员与权限" />
        {memberError && (
          <p className="field-error" role="alert">
            {memberError}
          </p>
        )}
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>成员</th>
                <th>邮箱</th>
                <th>角色</th>
                <th>状态</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {workspace.members.map((member) => (
                <tr key={member.id}>
                  <td>
                    <span className="row">
                      <ProtoAvatar name={member.name} />
                      <strong>{member.name}</strong>
                      {member.isCurrentUser && <span className="badge">我</span>}
                    </span>
                  </td>
                  <td>{member.email}</td>
                  <td>{member.role}</td>
                  <td>
                    <ProtoStatus status={member.status} />
                  </td>
                  <td>
                    <ProtoButton aria-label={`管理 ${member.name}`} onClick={() => setManageMember(member)}>
                      管理
                    </ProtoButton>
                  </td>
                </tr>
              ))}
              {workspace.invitations.map((invitation) => (
                <tr key={invitation.id}>
                  <td>
                    <strong>{invitation.email.split('@')[0] ?? invitation.email}</strong>
                  </td>
                  <td>{invitation.email}</td>
                  <td>{invitation.role}</td>
                  <td>
                    {invitation.status === '待接受' ? (
                      <ProtoStatus status="待加入" />
                    ) : (
                      <span className="badge">已过期</span>
                    )}
                  </td>
                  <td>
                    {invitation.status === '待接受' && (
                      <ProtoButton aria-label={`模拟加入 ${invitation.email}`} onClick={() => handleAccept(invitation)}>
                        模拟加入
                      </ProtoButton>
                    )}
                    <ProtoButton aria-label={`撤销邀请 ${invitation.email}`} onClick={() => handleRevoke(invitation)}>
                      撤销邀请
                    </ProtoButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {inviteOpen && (
        <InviteMemberDialog
          existingEmails={existingEmails}
          onClose={() => setInviteOpen(false)}
          onSubmit={handleInvite}
        />
      )}
      {manageMember && (
        <MemberManageDialog
          member={manageMember}
          onClose={() => setManageMember(null)}
          onSave={(role, status) => saveMember(manageMember, role, status)}
        />
      )}
      {profileOpen && (
        <TeamProfileDialog
          name={currentTeam.name}
          initial={currentTeam.initial}
          onClose={() => setProfileOpen(false)}
          onSave={(name, initial) => {
            updateTeam(currentTeam.id, { name, initial })
            setProfileOpen(false)
            showToast('团队资料已更新（本地演示）')
          }}
        />
      )}
    </>
  )
}

/**
 * 渲染成员角色与状态管理对话框。
 * @param props.member 当前成员；props.onClose 关闭回调；props.onSave 保存角色与状态。
 * @returns 与原型成员管理弹窗一致的原生对话框。
 */
function MemberManageDialog({
  member,
  onClose,
  onSave,
}: {
  member: TeamMember
  onClose: () => void
  onSave: (role: TeamRole, status: TeamMemberStatus) => void
}) {
  const [role, setRole] = useState<TeamRole>(member.role)
  const [status, setStatus] = useState<TeamMemberStatus>(member.status)
  return (
    <PrototypeDialog open title={`管理成员 · ${member.name}`} onClose={onClose}>
      <div className="form-grid">
        <ProtoField label="角色">
          <select
            value={role}
            onChange={(event) => {
              if (isTeamRole(event.target.value)) setRole(event.target.value)
            }}
          >
            {teamRoleOptions.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </ProtoField>
        <ProtoField label="状态">
          <select value={status} onChange={(event) => setStatus(event.target.value === '正常' ? '正常' : '已停用')}>
            <option value="正常">正常</option>
            <option value="已停用">已停用</option>
          </select>
        </ProtoField>
      </div>
      <p className="small muted">至少保留一位正常管理员；停用或降级最后一位管理员会被拒绝。</p>
      <div className="form-actions">
        <ProtoButton onClick={onClose}>取消</ProtoButton>
        <ProtoButton variant="primary" onClick={() => onSave(role, status)}>
          保存
        </ProtoButton>
      </div>
    </PrototypeDialog>
  )
}

/**
 * 渲染编辑团队资料对话框。
 * @param props.name 当前团队名称；props.initial 团队图标文字；props.onClose 关闭回调；props.onSave 保存回调。
 * @returns 与原型团队资料表单一致的原生对话框。
 */
function TeamProfileDialog({
  name,
  initial,
  onClose,
  onSave,
}: {
  name: string
  initial: string
  onClose: () => void
  onSave: (name: string, initial: string) => void
}) {
  const [nextName, setNextName] = useState(name)
  const [nextInitial, setNextInitial] = useState(initial)
  return (
    <PrototypeDialog open title="编辑团队资料" onClose={onClose}>
      <div className="form-grid">
        <ProtoField label="团队名称">
          <input value={nextName} maxLength={24} onChange={(event) => setNextName(event.target.value)} />
        </ProtoField>
        <ProtoField label="图标文字">
          <input value={nextInitial} maxLength={2} onChange={(event) => setNextInitial(event.target.value)} />
        </ProtoField>
      </div>
      <p className="small muted">团队名称与图标只影响本地演示数据，不修改真实团队或历史记录归属。</p>
      <div className="form-actions">
        <ProtoButton onClick={onClose}>取消</ProtoButton>
        <ProtoButton
          variant="primary"
          onClick={() => {
            if (nextName.trim() && nextInitial.trim()) onSave(nextName.trim(), nextInitial.trim())
          }}
        >
          保存
        </ProtoButton>
      </div>
    </PrototypeDialog>
  )
}

/**
 * 渲染非管理员访问团队管理时的权限说明。
 * @param props.role 当前演示角色；props.teamName 当前团队名称。
 * @returns 与原型 empty 结构一致的权限受限提示与返回入口，不展示成员或邀请数据。
 */
function TeamAdminDenied({ role, teamName }: { role: TeamRole; teamName: string }) {
  const navigate = useNavigate()
  return (
    <ProtoEmpty
      icon="shield"
      title="仅管理员可访问"
      description={`${teamName} · 当前演示角色为${role}，团队成员与权限由管理员维护。可在侧栏「设置」中切换为管理员后重新进入。`}
      action={<ProtoButton onClick={() => navigate('/prototype/projects')}>返回项目列表</ProtoButton>}
    />
  )
}

/**
 * 渲染邀请成员对话框。
 * @param props.existingEmails 已有成员与邀请邮箱，用于本地查重；
 * props.onClose 关闭对话框；props.onSubmit 提交邮箱与角色。
 * @returns 与原型 field/form-actions 结构一致的邀请表单；只写入本地邀请记录，不发送邮件。
 */
function InviteMemberDialog({
  existingEmails,
  onClose,
  onSubmit,
}: {
  existingEmails: readonly string[]
  onClose: () => void
  onSubmit: (email: string, role: TeamRole) => void
}) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<TeamRole>('开发者')
  const [error, setError] = useState('')

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmedEmail = email.trim()
    if (!emailPattern.test(trimmedEmail)) {
      setError('请输入有效的邮箱地址。')
      return
    }
    const duplicated = existingEmails.some((value) => value.toLowerCase() === trimmedEmail.toLowerCase())
    if (duplicated) {
      setError('该邮箱已是团队成员或已有待处理邀请。')
      return
    }
    onSubmit(trimmedEmail, role)
  }

  return (
    <PrototypeDialog open title="邀请团队成员" onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <ProtoField label="邮箱">
          <input
            type="email"
            autoComplete="off"
            value={email}
            maxLength={120}
            placeholder="name@example.com"
            onChange={(event) => setEmail(event.target.value)}
          />
        </ProtoField>
        <ProtoField label="角色">
          <select
            aria-label="邀请角色"
            value={role}
            onChange={(event) => {
              const nextRole = event.target.value
              if (isTeamRole(nextRole)) setRole(nextRole)
            }}
          >
            {teamRoleOptions.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </ProtoField>
        <p className="small muted">邀请有效期 7 天；重发会把到期时间顺延 7 天。</p>
        <p className="field-error" role="alert">
          {error}
        </p>
        <div className="form-actions">
          <ProtoButton onClick={onClose}>取消</ProtoButton>
          <ProtoButton type="submit" variant="primary">
            创建邀请
          </ProtoButton>
        </div>
      </form>
    </PrototypeDialog>
  )
}
