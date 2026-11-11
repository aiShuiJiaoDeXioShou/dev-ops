import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router'
import { ShieldAlert } from 'lucide-react'
import { PrototypeIcon } from '@/prototype/icons/icon'
import { TeamGitConnections } from '@/features/code/public'
import { pipelineNodesQueryOptions } from '@/features/pipeline/public'
import {
  CreateTeamDialog,
  EditTeamDialog,
  InviteMemberDialog,
  MemberManagement,
  useSession,
} from '@/features/identity/public'
import { Button } from '@/shared/ui/controls/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/controls/tabs'
import { EmptyState } from '@/shared/ui/page-state'

const TAB_VALUES = ['members', 'connections'] as const
type TabValue = (typeof TAB_VALUES)[number]

/** 判断 URL 页签参数是否为允许的团队设置分组。 */
function isTabValue(value: string | null): value is TabValue {
  return value !== null && (TAB_VALUES as readonly string[]).includes(value)
}

/** 团队设置页：团队资料在页头维护，成员与连接分成两个页签。 */
export function Component() {
  const { currentTeam, role } = useSession()
  const [createOpen, setCreateOpen] = useState(false)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [searchParams, setSearchParams] = useSearchParams()
  const tab: TabValue = isTabValue(searchParams.get('tab')) ? (searchParams.get('tab') as TabValue) : 'members'
  const changeTab = (value: string) => {
    const next = new URLSearchParams(searchParams)
    next.set('tab', value)
    setSearchParams(next, { replace: true })
  }
  if (!currentTeam) {
    return (
      <div className="catalog empty-page">
        <h1 className="sr-only">团队管理</h1>
        <EmptyState
          mascot="group"
          title="还没有加入团队"
          description="团队空间会承载项目、需求、Bug 和成员协作。请让平台管理员邀请你加入，或由平台管理员直接创建一个新团队。"
          action={
            <Button type="button" onClick={() => setCreateOpen(true)}>
              <PrototypeIcon name="plus" />
              创建团队
            </Button>
          }
        />
        <CreateTeamDialog open={createOpen} onOpenChange={setCreateOpen} />
      </div>
    )
  }
  const canManage = role === 'admin'
  const teamMark = currentTeam.iconText?.trim() || currentTeam.name.slice(0, 1)
  return (
    <div className="catalog team-admin">
      <h1 className="sr-only">团队管理</h1>
      <header className="team-page-head">
        <div className="team-identity">
          <span className="team-token active">
            <span>{teamMark}</span>
          </span>
          <div className="team-identity-copy">
            <h2>{currentTeam.name}</h2>
            {currentTeam.description && <p className="small quiet">{currentTeam.description}</p>}
          </div>
        </div>
        {canManage && (
          <div className="row team-head-actions">
            <Button type="button" variant="outline" onClick={() => setInviteOpen(true)}>
              邀请成员
            </Button>
            <Button type="button" variant="outline" onClick={() => setEditOpen(true)}>
              编辑团队
            </Button>
          </div>
        )}
      </header>
      <Tabs value={tab} onValueChange={changeTab} className="settings-tabs">
        <TabsList aria-label="团队设置分组">
          <TabsTrigger value="members">成员与权限</TabsTrigger>
          <TabsTrigger value="connections">连接与节点</TabsTrigger>
        </TabsList>
        <TabsContent value="members">
          {canManage ? (
            <MemberManagement teamId={currentTeam.id} canManage />
          ) : (
            <EmptyState
              icon={<ShieldAlert />}
              title="仅管理员可管理团队"
              description="当前角色可以继续使用项目、需求和 Bug 功能。如需调整成员或角色，请联系团队管理员。"
            />
          )}
        </TabsContent>
        <TabsContent value="connections" className="space-y-8">
          <TeamGitConnections teamId={currentTeam.id} canManage={canManage} />
          <NodeManagementEntry teamId={currentTeam.id} canManage={canManage} />
        </TabsContent>
      </Tabs>
      <InviteMemberDialog teamId={currentTeam.id} open={inviteOpen} onOpenChange={setInviteOpen} />
      <EditTeamDialog open={editOpen} onOpenChange={setEditOpen} />
    </div>
  )
}

/**
 * 执行节点入口卡片：展示在线与注册数量，写操作进入独立节点管理页。
 * @param props.teamId 团队标识；canManage 当前用户是否管理员。
 * @returns 与 Git 连接卡片同层级的设置区块。
 */
function NodeManagementEntry({ teamId, canManage }: { teamId: string; canManage: boolean }) {
  const nodes = useQuery(pipelineNodesQueryOptions(teamId))
  const items = nodes.data?.items ?? []
  const online = items.filter((node) => node.status === 'online').length
  const pending = items.filter((node) => node.status !== 'online' && node.status !== 'disabled').length
  return (
    <section aria-label="执行节点" className="card">
      <div className="section-heading">
        <h3>执行节点</h3>
        <span className="spacer" />
        {canManage ? (
          <Button variant="outline" size="sm" asChild>
            <Link to="/settings/pipeline-nodes">管理执行节点</Link>
          </Button>
        ) : null}
      </div>
      <p className="section-note">
        内置流水线通过团队自托管的执行节点运行任务；注册令牌与 Agent 令牌只在创建或轮换后显示一次。
      </p>
      <div className="node-summary" aria-label="执行节点概览">
        <span>
          <strong>{online}</strong>
          在线
        </span>
        <span>
          <strong>{items.length}</strong>
          已注册
        </span>
        <span>
          <strong>{pending}</strong>
          待连接
        </span>
      </div>
    </section>
  )
}

export default Component
