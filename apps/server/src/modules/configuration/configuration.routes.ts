import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { ApiError } from '../../platform/http/errors.ts'
import { ERROR_CODES } from '../../platform/http/error-codes.ts'
import { success } from '../../platform/http/response.ts'
import { requireActor, resolveActor } from '../identity/identity.actor.ts'
import type { ConfigurationService } from './configuration.service.ts'
import {
  createCredentialBodySchema,
  createEnvVarBodySchema,
  credentialDetailResponseSchema,
  credentialGrantParamsSchema,
  credentialListQuerySchema,
  credentialListResponseSchema,
  credentialParamsSchema,
  credentialResponseSchema,
  credentialRevealResponseSchema,
  teamCredentialParamsSchema,
  credentialUsageListResponseSchema,
  envVarListResponseSchema,
  envVarRemoveResponseSchema,
  envVarResponseSchema,
  grantCredentialBodySchema,
  projectEnvironmentParamsSchema,
  removeEnvVarBodySchema,
  revealCredentialBodySchema,
  revokeCredentialBodySchema,
  revokeGrantBodySchema,
  rotateCredentialBodySchema,
  teamParamsSchema,
  updateEnvVarBodySchema,
  usageQuerySchema,
  variableParamsSchema,
} from './configuration.schema.ts'

/**
 * 团队凭据库与项目环境变量路由。
 * @remarks 只使用 GET/POST；所有响应为 HTTP 200 统一信封，权限校验在 service 层完成。
 * 凭据明文只在创建/轮换请求体与密码二次确认后的查看响应中出现；列表和详情只返回元数据与掩码。
 */
export const configurationRoutes: FastifyPluginAsyncTypebox<{ service: ConfigurationService }> = async (
  app,
  options,
) => {
  const credentials = options.service.credentials
  const environmentVariables = options.service.environmentVariables

  app.get(
    '/teams/:teamId/credentials',
    {
      schema: {
        params: teamParamsSchema,
        querystring: credentialListQuerySchema,
        response: { 200: credentialListResponseSchema },
      },
    },
    async (request) => {
      const actor = await requireActor(request)
      return success(
        await credentials.listCredentials(actor, request.params.teamId, {
          ...request.query,
          page: request.query.page ?? 1,
          pageSize: request.query.pageSize ?? 20,
        }),
        request.id,
      )
    },
  )

  app.get(
    '/teams/:teamId/credentials/:credentialId',
    {
      schema: {
        params: teamCredentialParamsSchema,
        response: { 200: credentialDetailResponseSchema },
      },
    },
    async (request) => {
      const actor = await requireActor(request)
      return success(
        await credentials.getCredential(actor, request.params.teamId, request.params.credentialId),
        request.id,
      )
    },
  )

  app.post(
    '/teams/:teamId/credentials',
    {
      schema: {
        params: teamParamsSchema,
        body: createCredentialBodySchema,
        response: { 200: credentialResponseSchema },
      },
    },
    async (request) => {
      const actor = await requireActor(request)
      return success(await credentials.createCredential(actor, request.params.teamId, request.body), request.id)
    },
  )

  app.post(
    '/credentials/:credentialId/rotate',
    {
      schema: {
        params: credentialParamsSchema,
        body: rotateCredentialBodySchema,
        response: { 200: credentialResponseSchema },
      },
    },
    async (request) => {
      const actor = await requireActor(request)
      return success(await credentials.rotateCredential(actor, request.params.credentialId, request.body), request.id)
    },
  )

  app.post(
    '/credentials/:credentialId/revoke',
    {
      schema: {
        params: credentialParamsSchema,
        body: revokeCredentialBodySchema,
        response: { 200: credentialResponseSchema },
      },
    },
    async (request) => {
      const actor = await requireActor(request)
      return success(await credentials.revokeCredential(actor, request.params.credentialId, request.body), request.id)
    },
  )

  app.post(
    '/credentials/:credentialId/grants',
    {
      schema: {
        params: credentialParamsSchema,
        body: grantCredentialBodySchema,
        response: { 200: credentialResponseSchema },
      },
    },
    async (request) => {
      const actor = await requireActor(request)
      return success(await credentials.grantProject(actor, request.params.credentialId, request.body), request.id)
    },
  )

  app.post(
    '/credentials/:credentialId/grants/:projectId/revoke',
    {
      schema: {
        params: credentialGrantParamsSchema,
        body: revokeGrantBodySchema,
        response: { 200: credentialResponseSchema },
      },
    },
    async (request) => {
      const actor = await requireActor(request)
      return success(
        await credentials.revokeProjectGrant(
          actor,
          request.params.credentialId,
          request.params.projectId,
          request.body,
        ),
        request.id,
      )
    },
  )

  app.post(
    '/credentials/:credentialId/reveal-value',
    {
      schema: {
        params: credentialParamsSchema,
        body: revealCredentialBodySchema,
        response: { 200: credentialRevealResponseSchema },
      },
    },
    async (request, reply) => {
      const actor = await resolveActor(request.server.auth, request.server.tokenService, request.headers)
      if (!actor) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, '请先登录或提供有效 API Token')
      // 明文响应禁止任何层缓存，避免通过代理或浏览器历史再次取到。
      reply.header('cache-control', 'no-store')
      reply.header('pragma', 'no-cache')
      return success(
        await credentials.revealCredentialValue(actor, request.params.credentialId, {
          password: request.body.password,
          headers: request.headers,
        }),
        request.id,
      )
    },
  )

  app.get(
    '/credentials/:credentialId/usage',
    {
      schema: {
        params: credentialParamsSchema,
        querystring: usageQuerySchema,
        response: { 200: credentialUsageListResponseSchema },
      },
    },
    async (request) => {
      const actor = await requireActor(request)
      return success(
        await credentials.listUsage(actor, request.params.credentialId, {
          page: request.query.page ?? 1,
          pageSize: request.query.pageSize ?? 20,
        }),
        request.id,
      )
    },
  )

  app.get(
    '/projects/:projectId/environments/:environment/variables',
    {
      schema: {
        params: projectEnvironmentParamsSchema,
        response: { 200: envVarListResponseSchema },
      },
    },
    async (request) => {
      const actor = await requireActor(request)
      return success(
        await environmentVariables.listVariables(actor, request.params.projectId, request.params.environment),
        request.id,
      )
    },
  )

  app.post(
    '/projects/:projectId/environments/:environment/variables',
    {
      schema: {
        params: projectEnvironmentParamsSchema,
        body: createEnvVarBodySchema,
        response: { 200: envVarResponseSchema },
      },
    },
    async (request) => {
      const actor = await requireActor(request)
      return success(
        await environmentVariables.createVariable(
          actor,
          request.params.projectId,
          request.params.environment,
          request.body,
        ),
        request.id,
      )
    },
  )

  app.post(
    '/project-variables/:variableId/update',
    {
      schema: {
        params: variableParamsSchema,
        body: updateEnvVarBodySchema,
        response: { 200: envVarResponseSchema },
      },
    },
    async (request) => {
      const actor = await requireActor(request)
      return success(
        await environmentVariables.updateVariable(actor, request.params.variableId, request.body),
        request.id,
      )
    },
  )

  app.post(
    '/project-variables/:variableId/remove',
    {
      schema: {
        params: variableParamsSchema,
        body: removeEnvVarBodySchema,
        response: { 200: envVarRemoveResponseSchema },
      },
    },
    async (request) => {
      const actor = await requireActor(request)
      return success(
        await environmentVariables.removeVariable(actor, request.params.variableId, request.body),
        request.id,
      )
    },
  )
}
