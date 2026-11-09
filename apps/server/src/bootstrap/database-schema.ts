// 迁移入口汇总业务模块的表定义；数据库基础设施只依赖命名空间，不反向依赖业务模块。
export { appSchema } from '../platform/database/namespace.js'
export {
  authUser,
  authSession,
  authAccount,
  authVerification,
  platformAdmin,
  team,
  teamMember,
  invitation,
} from '../modules/identity/identity.tables.js'
export { comment, activity } from '../modules/collaboration/collaboration.tables.js'
export { project } from '../modules/projects/projects.tables.js'
export {
  requirement,
  requirementCollaborator,
  requirementTestSubmission,
} from '../modules/requirements/requirements.tables.js'
export { bug, bugRequirementLink, bugRegression } from '../modules/bugs/bugs.tables.js'
export { idempotencyRecord } from '../platform/database/idempotency.tables.js'
export { secret } from '../modules/configuration/configuration.tables.js'
export { gitConnection } from '../modules/integrations/integrations.tables.js'
export { gitRepository, projectRepository, codeReference } from '../modules/code/code.tables.js'
