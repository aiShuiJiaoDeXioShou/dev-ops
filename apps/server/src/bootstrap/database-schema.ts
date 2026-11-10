// 迁移入口汇总业务模块的表定义；数据库基础设施只依赖命名空间，不反向依赖业务模块。
export { appSchema } from '../platform/database/namespace.ts'
export {
  authUser,
  authSession,
  authAccount,
  authVerification,
  platformAdmin,
  team,
  teamMember,
  invitation,
  personalAccessToken,
} from '../modules/identity/identity.tables.ts'
export { comment, activity } from '../modules/collaboration/collaboration.tables.ts'
export { project, projectService, projectServiceRepository } from '../modules/projects/projects.tables.ts'
export {
  requirement,
  requirementCollaborator,
  requirementTestSubmission,
} from '../modules/requirements/requirements.tables.ts'
export { bug, bugRequirementLink, bugRegression } from '../modules/bugs/bugs.tables.ts'
export { idempotencyRecord } from '../platform/database/idempotency.tables.ts'
export {
  secret,
  credential,
  credentialVersion,
  credentialProjectGrant,
  projectEnvVar,
  credentialUsage,
} from '../modules/configuration/configuration.tables.ts'
export { gitConnection } from '../modules/integrations/integrations.tables.ts'
export { gitRepository, projectRepository, codeReference } from '../modules/code/code.tables.ts'
export {
  buildRecord,
  buildRecordCorrection,
  buildArtifact,
  buildRecordTarget,
  serviceRunVersion,
  serviceRunVersionChange,
  pipelineRun,
  pipelineRunStatus,
  externalReview,
  releaseResult,
} from '../modules/delivery/delivery.tables.ts'

export {
  skill,
  skillVersion,
  agentTemplate,
  agentTemplateVersion,
  projectTemplateSelection,
  templateSnapshotLink,
} from '../modules/knowledge/knowledge.tables.ts'
