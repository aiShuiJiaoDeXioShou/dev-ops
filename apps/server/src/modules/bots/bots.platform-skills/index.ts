import type { SkillCategory } from '../../knowledge/knowledge.types.ts'

interface PlatformSkill {
  id: string
  name: string
  identifier: string
  category: SkillCategory
  summary: string
  content: string
}

/** 平台发布的只读技能，与团队技能在同一标识冲突时优先。 */
export const platformBotSkills: readonly PlatformSkill[] = [
  {
    id: '00000000-0000-4000-8000-000000000601',
    name: '平台 CLI 用法',
    identifier: 'platform-cli',
    category: 'engineering',
    summary: '按当前团队和成员权限查询平台数据并核对结果。',
    content:
      '# 平台 CLI 用法\n\n先运行 devops whoami --json 与 devops team list --json。使用 devops --help 和业务子命令 --help 确认参数，复杂请求用 --file，大结果写工作目录文件后筛选。对分页查询使用返回的分页信息。遇到权限拒绝、结果未知或接口失败时，说明可确认的信息并先核对状态。',
  },
  {
    id: '00000000-0000-4000-8000-000000000602',
    name: '问题排查',
    identifier: 'investigate',
    category: 'delivery',
    summary: '定位项目问题，记录可验证的原因、影响和处理结果。',
    content:
      '# 问题排查\n\n确认项目、观察时间和复现条件。根据已有日志、需求、缺陷和运行记录验证假设。区分已验证的事实与待核对的推断。涉及平台写操作时，按操作者授权与当前状态执行。',
  },
]
