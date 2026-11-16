import type { ApiSuccessData } from '@dev-ops/api-client'
import type { MemberOption } from '@/shared/ui/controls/member-multiselect'

type TeamMember = ApiSuccessData<'/api/v1/teams/{teamId}/members', 'get'>[number]

/**
 * 把团队成员转换为人员选择控件的选项，保留头像以及停用成员的展示资料。
 * @param member 团队接口返回的成员。
 * @returns 包含状态和可用性标记的选项。
 */
export function toMemberOption(member: TeamMember): MemberOption {
  const isActive = member.status === 'active'
  return { ...member, status: isActive ? 'active' : 'disabled', available: isActive }
}
