import { apiClient } from '@/shared/api/client'

/** 凭据与环境变量写操作；不在前端复制业务规则。 */
export const configurationMutations = {
  createCredential: apiClient.createCredential.bind(apiClient),
  rotateCredential: apiClient.rotateCredential.bind(apiClient),
  revokeCredential: apiClient.revokeCredential.bind(apiClient),
  grantCredential: apiClient.grantCredential.bind(apiClient),
  revokeCredentialGrant: apiClient.revokeCredentialGrant.bind(apiClient),
  createEnvVariable: apiClient.createEnvVariable.bind(apiClient),
  updateEnvVariable: apiClient.updateEnvVariable.bind(apiClient),
  removeEnvVariable: apiClient.removeEnvVariable.bind(apiClient),
}
