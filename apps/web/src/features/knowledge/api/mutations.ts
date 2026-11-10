import { apiClient } from '@/shared/api/client'
import type { TeamRole } from '@/features/identity/public'

/** 知识资产可写角色。 */
export function canWriteKnowledge(role: TeamRole): boolean {
  return role === 'admin' || role === 'developer'
}

/** knowledge 写操作集合；调用方负责幂等键与缓存失效。 */
export const knowledgeMutations = {
  createSkill: apiClient.createSkill.bind(apiClient),
  updateSkill: apiClient.updateSkill.bind(apiClient),
  enableSkill: apiClient.enableSkill.bind(apiClient),
  disableSkill: apiClient.disableSkill.bind(apiClient),
  createTemplate: apiClient.createAgentTemplate.bind(apiClient),
  updateTemplate: apiClient.updateAgentTemplate.bind(apiClient),
  duplicateTemplate: apiClient.duplicateAgentTemplate.bind(apiClient),
  applyProjectTemplate: apiClient.applyProjectAgentTemplate.bind(apiClient),
  clearProjectTemplate: apiClient.clearProjectAgentTemplate.bind(apiClient),
  createSnapshotLink: apiClient.createTemplateSnapshotLink.bind(apiClient),
}
