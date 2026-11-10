import { Readable } from 'node:stream'
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { ERROR_CODES } from '../../platform/http/error-codes.ts'
import { ApiError } from '../../platform/http/errors.ts'
import { success } from '../../platform/http/response.ts'
import { isDeclaredArtifactOverLimit, type PipelineAgentService } from './pipeline.agent.service.ts'
import type { PipelineNodesService } from './pipeline.nodes.service.ts'
import {
  agentArtifactUploadResponseSchema,
  agentCompleteResponseSchema,
  agentHeartbeatResponseSchema,
  agentLeaseResponseSchema,
  agentLogsResponseSchema,
  agentRegisterResponseSchema,
  agentRenewResponseSchema,
  agentLogsUploadSchema,
  agentStepStatusResponseSchema,
  AgentCompleteRequestSchema,
  AgentHeartbeatRequestSchema,
  AgentLeaseRenewRequestSchema,
  AgentLeaseRequestSchema,
  AgentRegisterRequestSchema,
  AgentStepStatusRequestSchema,
  pipelineLeaseParamsSchema,
  pipelineLeaseStepParamsSchema,
} from './pipeline.schema.ts'

/** Agent 路由依赖。 */
export interface PipelineAgentRoutesOptions {
  nodes: PipelineNodesService
  agent: PipelineAgentService
  maxArtifactBytes: number
  maxLogChunkBytes: number
}

/** 从请求头读取租约令牌；只接受字符串值。 */
function leaseTokenFrom(headers: Record<string, string | string[] | undefined>): string | null {
  const value = headers['x-lease-token']
  const plain = Array.isArray(value) ? value[0] : value
  return typeof plain === 'string' && plain.trim().length > 0 ? plain.trim() : null
}

/** 读取必填请求头文本。 */
function requiredHeader(headers: Record<string, string | string[] | undefined>, name: string): string {
  const value = headers[name]
  const plain = Array.isArray(value) ? value[0] : value
  if (typeof plain !== 'string' || plain.trim().length === 0) {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, `缺少请求头 ${name}`)
  }
  return plain.trim()
}

/** 解析产物步骤序号请求头；非法值返回校验错误而不是猜测。 */
function stepIndexHeader(headers: Record<string, string | string[] | undefined>): number {
  const value = requiredHeader(headers, 'x-step-index')
  if (!/^\d{1,5}$/.test(value)) throw new ApiError(ERROR_CODES.VALIDATION_ERROR, 'X-Step-Index 不合法')
  const index = Number(value)
  if (!Number.isSafeInteger(index) || index > 10_000) {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, 'X-Step-Index 不合法')
  }
  return index
}

/** 解析产物名请求头；按契约使用 percent-encoding。 */
function artifactNameHeader(headers: Record<string, string | string[] | undefined>): string {
  const value = requiredHeader(headers, 'x-artifact-name')
  try {
    return decodeURIComponent(value)
  } catch {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, 'X-Artifact-Name 编码不合法')
  }
}

/** 解析产物校验和请求头；必须是 64 位小写十六进制。 */
function sha256Header(headers: Record<string, string | string[] | undefined>): string {
  const value = requiredHeader(headers, 'x-content-sha256').toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(value)) {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, 'X-Content-Sha256 不合法')
  }
  return value
}

function isReadableBody(body: unknown): body is Readable {
  return body instanceof Readable
}

/** 丢弃剩余请求体，保证提前返回业务错误时连接不被重置。 */
async function drainRequestBody(body: unknown): Promise<void> {
  if (!isReadableBody(body)) return
  body.resume()
  await new Promise<void>((resolve) => {
    body.once('end', resolve)
    body.once('close', resolve)
    body.once('error', resolve)
  })
}

/** 短轮询等待任务；Agent 长轮询最多占用请求 waitSeconds 秒。 */
async function claimWithWait(
  agent: PipelineAgentService,
  nodes: PipelineNodesService,
  scope: Parameters<PipelineAgentService['claimLease']>[0],
  waitSeconds: number,
): Promise<ReturnType<PipelineAgentService['claimLease']>> {
  const deadline = Date.now() + Math.min(Math.max(waitSeconds, 0), 30) * 1000
  const first = await agent.claimLease(scope)
  if (first) return first
  while (Date.now() < deadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, 500))
    const next = await agent.claimLease(scope)
    if (next) return next
  }
  void nodes
  return null
}

/**
 * 注册 Agent 协议路由：注册、心跳、租约领取/续约、步骤状态、日志、产物与完成上报。
 * @param app Fastify 实例，已挂载 `/api/v1` 前缀。
 * @param options 节点服务、执行服务与产物体积上限。
 * @remarks Agent 端点全部使用 POST；无业务数据时 `data` 为 null；
 * 租约作用域请求使用 `Authorization: Bearer <agentToken>` 与 `X-Lease-Token`。
 */
export const pipelineAgentRoutes: FastifyPluginAsyncTypebox<PipelineAgentRoutesOptions> = async (app, options) => {
  app.post(
    '/agent/register',
    {
      schema: {
        tags: ['devops-internal'],
        body: AgentRegisterRequestSchema,
        response: { 200: agentRegisterResponseSchema },
      },
    },
    async (request) => {
      const result = await options.nodes.registerAgent({
        registrationToken: request.body.registrationToken,
        name: request.body.name,
        os: request.body.os,
        arch: request.body.arch,
        capabilities: request.body.capabilities,
        agentVersion: request.body.agentVersion,
      })
      return success(result, request.id)
    },
  )

  app.post(
    '/agent/heartbeat',
    {
      schema: {
        tags: ['devops-internal'],
        body: AgentHeartbeatRequestSchema,
        response: { 200: agentHeartbeatResponseSchema },
      },
    },
    async (request) => {
      const authenticated = await options.nodes.authenticateAgent(request.headers)
      const result = await options.nodes.heartbeat(authenticated.node, {
        version: request.body.version,
        runningLeaseId: request.body.runningLeaseId ?? null,
        capabilities: request.body.capabilities ?? null,
      })
      return success(result, request.id)
    },
  )

  app.post(
    '/agent/lease',
    {
      schema: {
        tags: ['devops-internal'],
        body: AgentLeaseRequestSchema,
        response: { 200: agentLeaseResponseSchema },
      },
    },
    async (request) => {
      const authenticated = await options.nodes.authenticateAgent(request.headers)
      const scope = options.agent.toAgentScope(authenticated.node)
      const lease = await claimWithWait(options.agent, options.nodes, scope, request.body.waitSeconds ?? 0)
      return success(lease, request.id)
    },
  )

  app.post(
    '/agent/lease/:leaseId/renew',
    {
      schema: {
        tags: ['devops-internal'],
        params: pipelineLeaseParamsSchema,
        body: AgentLeaseRenewRequestSchema,
        response: { 200: agentRenewResponseSchema },
      },
    },
    async (request) => {
      const authenticated = await options.nodes.authenticateAgent(request.headers)
      const scope = options.agent.toAgentScope(authenticated.node)
      return success(
        await options.agent.renewLease(
          scope,
          request.params.leaseId,
          leaseTokenFrom(request.headers),
          request.body.leaseToken,
        ),
        request.id,
      )
    },
  )

  app.post(
    '/agent/lease/:leaseId/steps/:stepIndex/status',
    {
      schema: {
        tags: ['devops-internal'],
        params: pipelineLeaseStepParamsSchema,
        body: AgentStepStatusRequestSchema,
        response: { 200: agentStepStatusResponseSchema },
      },
    },
    async (request) => {
      const authenticated = await options.nodes.authenticateAgent(request.headers)
      const scope = options.agent.toAgentScope(authenticated.node)
      return success(
        await options.agent.reportStepStatus(
          scope,
          request.params.leaseId,
          request.params.stepIndex,
          leaseTokenFrom(request.headers),
          {
            status: request.body.status,
            exitCode: request.body.exitCode ?? null,
            errorCode: request.body.errorCode ?? null,
            errorMessage: request.body.errorMessage ?? null,
          },
        ),
        request.id,
      )
    },
  )

  app.post(
    '/agent/lease/:leaseId/logs',
    {
      bodyLimit: Math.max(64 * 1024, options.maxLogChunkBytes * 2),
      schema: {
        tags: ['devops-internal'],
        params: pipelineLeaseParamsSchema,
        body: agentLogsUploadSchema,
        response: { 200: agentLogsResponseSchema },
      },
    },
    async (request) => {
      const authenticated = await options.nodes.authenticateAgent(request.headers)
      const scope = options.agent.toAgentScope(authenticated.node)
      return success(
        await options.agent.uploadLogs(scope, request.params.leaseId, leaseTokenFrom(request.headers), {
          chunks: request.body.chunks,
        }),
        request.id,
      )
    },
  )

  app.post(
    '/agent/lease/:leaseId/artifacts',
    {
      // 留出 1MB 余量，让超限请求进入存储层的业务错误（AGENT_ARTIFACT_LIMIT_EXCEEDED）而不是被 HTTP 层直接拒绝。
      bodyLimit: options.maxArtifactBytes + 1024 * 1024,
      schema: {
        tags: ['devops-internal'],
        params: pipelineLeaseParamsSchema,
        response: { 200: agentArtifactUploadResponseSchema },
      },
    },
    async (request) => {
      const authenticated = await options.nodes.authenticateAgent(request.headers)
      const scope = options.agent.toAgentScope(authenticated.node)
      if (!isReadableBody(request.body)) {
        throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '产物上传请求体必须是 application/octet-stream 流')
      }
      const contentLength = Array.isArray(request.headers['content-length'])
        ? request.headers['content-length'][0]
        : request.headers['content-length']
      if (isDeclaredArtifactOverLimit(contentLength, options.maxArtifactBytes)) {
        await drainRequestBody(request.body)
        throw new ApiError(ERROR_CODES.AGENT_ARTIFACT_LIMIT_EXCEEDED, '产物超过大小上限')
      }
      return success(
        await options.agent.uploadArtifact(scope, request.params.leaseId, leaseTokenFrom(request.headers), {
          stepIndex: stepIndexHeader(request.headers),
          name: artifactNameHeader(request.headers),
          sha256: sha256Header(request.headers),
          source: request.body,
        }),
        request.id,
      )
    },
  )

  app.post(
    '/agent/lease/:leaseId/complete',
    {
      schema: {
        tags: ['devops-internal'],
        params: pipelineLeaseParamsSchema,
        body: AgentCompleteRequestSchema,
        response: { 200: agentCompleteResponseSchema },
      },
    },
    async (request) => {
      const authenticated = await options.nodes.authenticateAgent(request.headers)
      const scope = options.agent.toAgentScope(authenticated.node)
      return success(
        await options.agent.completeLease(scope, request.params.leaseId, leaseTokenFrom(request.headers), {
          status: request.body.status,
          errorCode: request.body.errorCode ?? null,
          errorMessage: request.body.errorMessage ?? null,
        }),
        request.id,
      )
    },
  )
}
