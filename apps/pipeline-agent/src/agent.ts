import { createReadStream } from 'node:fs'
import { arch, platform } from 'node:os'

import type {
  AgentArtifactUploadResponse,
  AgentCompleteRequest,
  AgentCompleteResponse,
  AgentHeartbeatResponse,
  AgentLeaseRenewResponse,
  AgentLogChunk,
  AgentLogsResponse,
  AgentRegisterResponse,
  AgentStepStatusRequest,
  AgentStepStatusResponse,
  PipelineLease,
} from '@dev-ops/pipeline-protocol'
import { PROTOCOL_VERSION } from '@dev-ops/pipeline-protocol'

import type { PlatformHttp } from './client.ts'
import { AGENT_ERROR_CODES, AgentApiError, classifyFatalError, isAgentErrorCode } from './errors.ts'
import type { AgentLogger } from './logger.ts'
import type { SecretMasker } from './masking.ts'
import {
  parseArtifactResponse,
  parseCompleteResponse,
  parseHeartbeatResponse,
  parseLeaseResponse,
  parseLogsResponse,
  parseRegisterResponse,
  parseRenewResponse,
  parseStepStatusResponse,
} from './protocol-parse.ts'
import { AGENT_VERSION } from './version.ts'

/** 注册后的 Agent 会话参数；租约 TTL 用于计算续约间隔，都不写入磁盘。 */
export interface AgentSessionInfo {
  nodeId: string
  protocolVersion: number
  heartbeatIntervalSeconds: number
  /** 租约有效期，单位秒；用于推导续约间隔。 */
  leaseTtlSeconds: number
}

/** 心跳结果；cancelLeaseIds 是平台下发的取消通道。 */
export interface AgentHeartbeatResult {
  heartbeatIntervalSeconds: number
  cancelLeaseIds: readonly string[]
}

/** 产物上传输入；内容由本地临时 tar 文件流式读取，上传后由调用方清理。 */
export interface AgentArtifactUploadInput {
  stepIndex: number
  name: string
  sha256: string
  sizeBytes: number
  filePath: string
}

/** Agent 协议客户端；所有请求都以内存中的 Agent 令牌鉴权。 */
export interface AgentClient {
  /** 是否已持有 Agent 长期令牌（只暴露布尔值，不暴露令牌本身）。 */
  readonly hasAgentToken: boolean
  /** 注册（或复用配置的长期令牌）并返回会话参数；重复调用返回首次结果。 */
  ensureRegistered(): Promise<AgentSessionInfo>
  /** 发送心跳并领取取消通知。 */
  heartbeat(runningLeaseId: string | null): Promise<AgentHeartbeatResult>
  /** 短轮询领取租约；无任务返回 null。 */
  acquireLease(waitSeconds: number): Promise<PipelineLease | null>
  /** 续约并读取 cancelRequested。 */
  renewLease(lease: PipelineLease): Promise<AgentLeaseRenewResponse>
  /** 上报步骤状态。 */
  reportStepStatus(
    lease: PipelineLease,
    stepIndex: number,
    body: AgentStepStatusRequest,
  ): Promise<AgentStepStatusResponse>
  /** 上传一批日志分片。 */
  uploadLogs(lease: PipelineLease, chunks: readonly AgentLogChunk[]): Promise<AgentLogsResponse>
  /** 流式上传产物 tar 文件。 */
  uploadArtifact(lease: PipelineLease, input: AgentArtifactUploadInput): Promise<AgentArtifactUploadResponse>
  /** 上报运行完成。 */
  complete(lease: PipelineLease, body: AgentCompleteRequest): Promise<AgentCompleteResponse>
}

export interface AgentClientOptions {
  http: PlatformHttp
  logger: AgentLogger
  masker: SecretMasker
  /** 注册节点名；服务端以注册令牌绑定的节点为权威身份。 */
  nodeName: string
  capabilities: readonly string[]
  registrationToken?: string
  agentToken?: string
  artifactUploadTimeoutMs: number
  /** Agent 版本，测试可覆盖。 */
  agentVersion?: string
}

/** 仅配置长期令牌时的默认会话参数；平台在心跳响应中会返回真实心跳间隔。 */
const DEFAULT_HEARTBEAT_INTERVAL_SECONDS = 15
const DEFAULT_LEASE_TTL_SECONDS = 90

/**
 * 创建 Agent 协议客户端。
 * @param options HTTP 客户端、脱敏器、节点身份与令牌配置。
 * @returns 注册、心跳、租约、步骤状态、日志、产物与完成上报的调用接口。
 * @remarks 令牌只保存在闭包内存中，不写磁盘、不打印；所有请求走带超时与有限重试的 PlatformHttp。
 */
export function createAgentClient(options: AgentClientOptions): AgentClient {
  const agentVersion = options.agentVersion ?? AGENT_VERSION
  const machineOs = platform()
  const machineArch = arch()
  let agentToken = options.agentToken
  let session: AgentSessionInfo | undefined

  if (agentToken) options.masker.addSecrets([agentToken])
  if (options.registrationToken) options.masker.addSecrets([options.registrationToken])

  function requireToken(): string {
    if (!agentToken) throw new AgentApiError(AGENT_ERROR_CODES.tokenInvalid, 'Agent 尚未注册或缺少长期令牌')
    return agentToken
  }

  function authHeaders(lease?: PipelineLease): Record<string, string> {
    const headers: Record<string, string> = { authorization: `Bearer ${requireToken()}` }
    if (lease) headers['x-lease-token'] = lease.leaseToken
    return headers
  }

  function leasePath(lease: PipelineLease, suffix: string): string {
    return `/api/v1/agent/lease/${encodeURIComponent(lease.leaseId)}${suffix}`
  }

  /** 把平台业务错误中的 message 再脱敏一次，避免平台侧漏遮蔽时污染 Agent 日志。 */
  function rethrowMasked(error: unknown): never {
    if (error instanceof AgentApiError) {
      throw new AgentApiError(error.code, options.masker.maskText(error.message), error.requestId, error.data)
    }
    throw error
  }

  async function ensureRegistered(): Promise<AgentSessionInfo> {
    if (session) return session
    if (!options.registrationToken) {
      if (!agentToken) throw new AgentApiError(AGENT_ERROR_CODES.tokenInvalid, '缺少 AGENT_TOKEN，无法开始心跳')
      session = {
        nodeId: '',
        protocolVersion: PROTOCOL_VERSION,
        heartbeatIntervalSeconds: DEFAULT_HEARTBEAT_INTERVAL_SECONDS,
        leaseTtlSeconds: DEFAULT_LEASE_TTL_SECONDS,
      }
      return session
    }
    let response: AgentRegisterResponse
    try {
      const data = await options.http.request({
        method: 'POST',
        path: '/api/v1/agent/register',
        body: {
          registrationToken: options.registrationToken,
          name: options.nodeName,
          os: machineOs,
          arch: machineArch,
          capabilities: [...options.capabilities],
          agentVersion,
        },
      })
      response = parseRegisterResponse(data)
    } catch (error) {
      rethrowMasked(error)
    }
    if (response.protocolVersion !== PROTOCOL_VERSION) {
      throw new AgentApiError(
        AGENT_ERROR_CODES.versionUnsupported,
        `平台协议版本 ${response.protocolVersion} 与 Agent 协议版本 ${PROTOCOL_VERSION} 不兼容`,
      )
    }
    agentToken = response.agentToken
    options.masker.addSecrets([response.agentToken])
    session = {
      nodeId: response.nodeId,
      protocolVersion: response.protocolVersion,
      heartbeatIntervalSeconds: response.heartbeatIntervalSeconds,
      leaseTtlSeconds: response.leaseTtlSeconds,
    }
    options.logger.info(`注册成功：节点 ${response.nodeId}，协议版本 ${response.protocolVersion}`)
    return session
  }

  return {
    get hasAgentToken(): boolean {
      return agentToken !== undefined
    },

    ensureRegistered,

    async heartbeat(runningLeaseId: string | null): Promise<AgentHeartbeatResult> {
      try {
        const data = await options.http.request({
          method: 'POST',
          path: '/api/v1/agent/heartbeat',
          headers: authHeaders(),
          body: {
            version: agentVersion,
            runningLeaseId,
            capabilities: [...options.capabilities],
          },
        })
        const response: AgentHeartbeatResponse = parseHeartbeatResponse(data)
        return {
          heartbeatIntervalSeconds: response.heartbeatIntervalSeconds,
          cancelLeaseIds: response.cancelLeaseIds,
        }
      } catch (error) {
        rethrowMasked(error)
      }
    },

    async acquireLease(waitSeconds: number): Promise<PipelineLease | null> {
      try {
        // 平台会按 waitSeconds 长轮询（最长 30 秒）；请求超时必须大于该等待，
        // 否则会在平台仍可能领取任务时中止请求，造成响应丢失。
        const data = await options.http.request({
          method: 'POST',
          path: '/api/v1/agent/lease',
          headers: authHeaders(),
          body: { waitSeconds },
          timeoutMs: (Math.max(0, waitSeconds) + 15) * 1_000,
        })
        const lease = parseLeaseResponse(data)
        if (lease) {
          options.masker.addSecrets([lease.leaseToken])
          options.logger.info(`领取租约 ${lease.leaseId}，运行 ${lease.run.runId}（${lease.run.workflowName}）`)
        }
        return lease
      } catch (error) {
        rethrowMasked(error)
      }
    },

    async renewLease(lease: PipelineLease): Promise<AgentLeaseRenewResponse> {
      try {
        const data = await options.http.request({
          method: 'POST',
          path: leasePath(lease, '/renew'),
          headers: authHeaders(lease),
          body: { leaseToken: lease.leaseToken },
        })
        return parseRenewResponse(data)
      } catch (error) {
        rethrowMasked(error)
      }
    },

    async reportStepStatus(
      lease: PipelineLease,
      stepIndex: number,
      body: AgentStepStatusRequest,
    ): Promise<AgentStepStatusResponse> {
      try {
        const data = await options.http.request({
          method: 'POST',
          path: leasePath(lease, `/steps/${String(stepIndex)}/status`),
          headers: authHeaders(lease),
          body,
        })
        return parseStepStatusResponse(data)
      } catch (error) {
        rethrowMasked(error)
      }
    },

    async uploadLogs(lease: PipelineLease, chunks: readonly AgentLogChunk[]): Promise<AgentLogsResponse> {
      try {
        const data = await options.http.request({
          method: 'POST',
          path: leasePath(lease, '/logs'),
          headers: authHeaders(lease),
          body: { chunks: [...chunks] },
        })
        return parseLogsResponse(data)
      } catch (error) {
        rethrowMasked(error)
      }
    },

    async uploadArtifact(lease: PipelineLease, input: AgentArtifactUploadInput): Promise<AgentArtifactUploadResponse> {
      try {
        const data = await options.http.uploadBinary({
          path: leasePath(lease, '/artifacts'),
          headers: {
            ...authHeaders(lease),
            'x-step-index': String(input.stepIndex),
            'x-artifact-name': encodeURIComponent(input.name),
            'x-content-sha256': input.sha256,
            'content-length': String(input.sizeBytes),
          },
          createBody: () => createReadStream(input.filePath),
          timeoutMs: options.artifactUploadTimeoutMs,
        })
        return parseArtifactResponse(data)
      } catch (error) {
        rethrowMasked(error)
      }
    },

    async complete(lease: PipelineLease, body: AgentCompleteRequest): Promise<AgentCompleteResponse> {
      try {
        const data = await options.http.request({
          method: 'POST',
          path: leasePath(lease, '/complete'),
          headers: authHeaders(lease),
          body,
        })
        return parseCompleteResponse(data)
      } catch (error) {
        rethrowMasked(error)
      }
    },
  }
}

/**
 * 判断错误是否要求 Agent 立即停止（令牌失效、节点停用、版本不兼容）。
 * @param error 客户端错误。
 * @returns 停止原因；普通业务错误或网络错误返回 null。
 * @remarks 保留该导出的原因是 index/daemon 需要把错误分类转换为进程退出码。
 */
export function fatalReasonOf(error: unknown): 'exit' | 'stop-claiming' | null {
  return classifyFatalError(error)
}

/** 判断错误是否表示租约已失效；调用方必须停止本地执行且不上报成功。 */
export function isLeaseGone(error: unknown): boolean {
  return (
    isAgentErrorCode(error, AGENT_ERROR_CODES.leaseExpired) || isAgentErrorCode(error, AGENT_ERROR_CODES.leaseInvalid)
  )
}
