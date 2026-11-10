import { queryOptions } from '@tanstack/react-query'
import type { ApiQuery, ApiSuccessData } from '@dev-ops/api-client'
import { apiClient } from '@/shared/api/client'

/** 凭据列表筛选。 */
export type CredentialListQuery = ApiQuery<'/api/v1/teams/{teamId}/credentials', 'get'>
export type CredentialList = ApiSuccessData<'/api/v1/teams/{teamId}/credentials', 'get'>
export type CredentialDetail = ApiSuccessData<'/api/v1/teams/{teamId}/credentials/{credentialId}', 'get'>
export type CredentialUsageList = ApiSuccessData<'/api/v1/credentials/{credentialId}/usage', 'get'>
export type EnvVarList = ApiSuccessData<'/api/v1/projects/{projectId}/environments/{environment}/variables', 'get'>

export function credentialsQueryOptions(teamId: string, query: CredentialListQuery) {
  return queryOptions({
    queryKey: ['configuration', 'credentials', teamId, query],
    queryFn: ({ signal }) => apiClient.listCredentials(teamId, query, { signal }),
    enabled: Boolean(teamId),
  })
}

export function credentialQueryOptions(teamId: string, credentialId: string) {
  return queryOptions({
    queryKey: ['configuration', 'credential', teamId, credentialId],
    queryFn: ({ signal }) => apiClient.getCredential(teamId, credentialId, { signal }),
    enabled: Boolean(teamId && credentialId),
  })
}

export function credentialUsageQueryOptions(credentialId: string) {
  return queryOptions({
    queryKey: ['configuration', 'credential-usage', credentialId],
    queryFn: ({ signal }) => apiClient.listCredentialUsage(credentialId, { page: 1, pageSize: 20 }, { signal }),
    enabled: Boolean(credentialId),
  })
}

export function envVariablesQueryOptions(projectId: string, environment: string) {
  return queryOptions({
    queryKey: ['configuration', 'env-vars', projectId, environment],
    queryFn: ({ signal }) => apiClient.listEnvVariables(projectId, environment, { signal }),
    enabled: Boolean(projectId && environment),
  })
}
