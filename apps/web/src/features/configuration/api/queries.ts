import { queryOptions } from '@tanstack/react-query'
import type { ApiQuery, ApiSuccessData } from '@dev-ops/api-client'
import { apiClient } from '@/shared/api/client'

/** 凭据列表筛选。 */
export type CredentialListQuery = ApiQuery<'/api/v1/teams/{teamId}/credentials', 'get'>
export type CredentialList = ApiSuccessData<'/api/v1/teams/{teamId}/credentials', 'get'>
export type CredentialDetail = ApiSuccessData<'/api/v1/teams/{teamId}/credentials/{credentialId}', 'get'>
export type CredentialUsageList = ApiSuccessData<'/api/v1/credentials/{credentialId}/usage', 'get'>
export type EnvVarList = ApiSuccessData<'/api/v1/projects/{projectId}/environments/{environment}/variables', 'get'>

/**
 * 构建团队凭据列表查询。
 * @param teamId 团队标识。
 * @param query 列表筛选及分页条件。
 * @returns 按团队和筛选条件区分缓存的查询配置。
 */
export function credentialsQueryOptions(teamId: string, query: CredentialListQuery) {
  return queryOptions({
    queryKey: ['configuration', 'credentials', teamId, query],
    queryFn: ({ signal }) => apiClient.listCredentials(teamId, query, { signal }),
    enabled: Boolean(teamId),
  })
}

/**
 * 构建团队凭据详情查询。
 * @param teamId 团队标识。
 * @param credentialId 凭据标识。
 * @returns 凭据元数据的查询配置，缺少标识时禁用请求。
 */
export function credentialQueryOptions(teamId: string, credentialId: string) {
  return queryOptions({
    queryKey: ['configuration', 'credential', teamId, credentialId],
    queryFn: ({ signal }) => apiClient.getCredential(teamId, credentialId, { signal }),
    enabled: Boolean(teamId && credentialId),
  })
}

/**
 * 构建凭据近期使用记录查询。
 * @param credentialId 凭据标识。
 * @returns 最近 20 条使用记录的查询配置。
 */
export function credentialUsageQueryOptions(credentialId: string) {
  return queryOptions({
    queryKey: ['configuration', 'credential-usage', credentialId],
    queryFn: ({ signal }) => apiClient.listCredentialUsage(credentialId, { page: 1, pageSize: 20 }, { signal }),
    enabled: Boolean(credentialId),
  })
}

/**
 * 构建项目环境变量查询。
 * @param projectId 项目标识。
 * @param environment 环境标识。
 * @returns 按项目和环境区分缓存的查询配置。
 */
export function envVariablesQueryOptions(projectId: string, environment: string) {
  return queryOptions({
    queryKey: ['configuration', 'env-vars', projectId, environment],
    queryFn: ({ signal }) => apiClient.listEnvVariables(projectId, environment, { signal }),
    enabled: Boolean(projectId && environment),
  })
}
