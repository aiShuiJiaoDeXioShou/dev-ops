import type { components, paths } from './generated/api.ts'
import validateHealth from './generated/health.mjs'
import validateReadiness from './generated/readiness.mjs'
import validateError from './generated/error.mjs'
import { validateResponse } from './generated/response-validators.mjs'

export type { components, paths } from './generated/api.ts'

/** 生成的 OpenAPI 路径集合。 */
type ApiPath = keyof paths
/** 自研接口只允许 GET/POST。 */
type ApiMethod = 'get' | 'post'
type Operation<P extends ApiPath, M extends ApiMethod> = paths[P] extends Record<M, infer O> ? O : never
type ResponseJson<P extends ApiPath, M extends ApiMethod> =
  Operation<P, M> extends { responses: { 200: { content: { 'application/json': infer R } } } } ? R : never
/** 从 OpenAPI 提取的 200 成功 data 类型。 */
export type ApiSuccessData<P extends ApiPath, M extends ApiMethod> =
  Extract<ResponseJson<P, M>, { success: true }> extends { data: infer D } ? D : never
/** 从 OpenAPI 提取的 POST 请求体类型。 */
export type ApiBody<P extends ApiPath, M extends ApiMethod> =
  Operation<P, M> extends { requestBody: { content: { 'application/json': infer B } } } ? B : undefined
/** 从 OpenAPI 提取的查询参数类型。 */
export type ApiQuery<P extends ApiPath, M extends ApiMethod> =
  Operation<P, M> extends { parameters: { query?: infer Q } } ? Q : undefined

export interface ApiCallOptions {
  signal?: AbortSignal
  idempotencyKey?: string
}

function isSuccessEnvelope(value: unknown): value is ApiSuccessEnvelope<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'success' in value &&
    value.success === true &&
    'code' in value &&
    value.code === 'OK' &&
    'message' in value &&
    typeof value.message === 'string' &&
    'requestId' in value &&
    typeof value.requestId === 'string' &&
    'data' in value
  )
}

function isFailureEnvelope(value: unknown): value is ApiFailureEnvelope {
  return (
    typeof value === 'object' &&
    value !== null &&
    'success' in value &&
    value.success === false &&
    'code' in value &&
    typeof value.code === 'string' &&
    'message' in value &&
    typeof value.message === 'string' &&
    'requestId' in value &&
    typeof value.requestId === 'string'
  )
}

function toQueryString(query: unknown): string {
  if (typeof query !== 'object' || query === null) return ''
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue
    params.set(key, String(value))
  }
  const text = params.toString()
  return text ? `?${text}` : ''
}

function segment(value: string): string {
  return encodeURIComponent(value)
}

export type HealthEnvelope = paths['/api/v1/health']['get']['responses'][200]['content']['application/json']
export type ReadinessEnvelope = paths['/api/v1/ready']['get']['responses'][200]['content']['application/json']
export type HealthResponse = Extract<HealthEnvelope, { success: true }>['data']
export type ReadinessResponse = Extract<ReadinessEnvelope, { success: true }>['data']
export type ApiErrorResponse = components['schemas']['def-0']
export type ApiSuccessEnvelope<T> = {
  success: true
  code: 'OK'
  message: string
  requestId: string
  data: T
}
export type ApiFailureEnvelope = {
  success: false
  code: string
  message: string
  requestId: string
  data?: unknown
}
export type RequestErrorCode = 'HTTP_ERROR' | 'NETWORK_ERROR' | 'TIMEOUT' | 'INVALID_RESPONSE' | 'BUSINESS_ERROR'

interface RequestErrorOptions {
  code: RequestErrorCode
  status?: number
  requestId?: string | null
  responseValid?: boolean
  serverCode?: string
  /** 业务失败信封中的可选 data；仅在调用方明确需要展示结构化原因时使用。 */
  data?: unknown
}

/** 只携带可展示的说明和排障标识，不保存原始响应或凭据。 */
export class RequestError extends Error {
  readonly code: RequestErrorCode
  readonly status: number | null
  readonly requestId: string | null
  readonly responseValid: boolean | null
  readonly serverCode: string | null
  /** 业务失败信封中的可选 data；调用方必须先校验再使用，不能直接信任结构。 */
  readonly data: unknown

  /**
   * 创建统一请求错误。
   * @param message 客户端生成的可展示说明，不使用服务端任意正文。
   * @param options 错误类别、状态、请求标识及错误响应契约的校验结果。
   * @returns 错误实例；不记录日志或保存原始响应。
   */
  constructor(message: string, options: RequestErrorOptions) {
    super(message)
    this.name = 'RequestError'
    this.code = options.code
    this.status = options.status ?? null
    this.requestId = options.requestId ?? null
    this.responseValid = options.responseValid ?? null
    this.serverCode = options.serverCode ?? null
    this.data = options.data
  }
}

export interface ApiClientOptions {
  baseUrl: string | URL
  timeoutMs?: number
  credentials?: RequestCredentials
  /** API Token；CLI 使用 Bearer，浏览器不设置。 */
  token?: string
  /** 是否按生成契约校验业务响应；测试可显式关闭，运行时默认开启。 */
  validateResponses?: boolean
  fetch?: typeof fetch
}

/**
 * 生成前端幂等键，供创建、评论、提测等 POST 动作使用。
 * @returns 随机 UUID 字符串；不依赖业务状态。
 */
export function createIdempotencyKey(): string {
  return globalThis.crypto.randomUUID()
}

/**
 * 判断错误是否为指定业务错误码。
 * @param error 任意捕获值。
 * @param code 可选业务错误码；省略时只判断业务错误类别。
 * @returns 是否为匹配的 RequestError。
 */
export function isBusinessError(error: unknown, code?: string): error is RequestError {
  return (
    error instanceof RequestError &&
    error.code === 'BUSINESS_ERROR' &&
    (code === undefined || error.serverCode === code)
  )
}

function createBusinessError(body: ApiFailureEnvelope, requestId: string): RequestError {
  return new RequestError('操作未完成，请稍后重试。', {
    code: 'BUSINESS_ERROR',
    status: 200,
    requestId,
    responseValid: true,
    serverCode: body.code,
    data: body.data,
  })
}

/**
 * 创建不依赖浏览器全局对象的 API 客户端，不发起请求。
 * @param options 服务基础地址、超时、会话策略及可替换的 fetch 实现。
 * @returns 提供已校验响应信封的健康与就绪请求；每次请求单独处理取消和超时。
 * @throws 地址包含凭据、查询参数或片段，协议不支持，或超时不在 1 至 300000 毫秒时抛出错误。
 */
export function createApiClient(options: ApiClientOptions) {
  let baseUrl: URL
  try {
    baseUrl = new URL(options.baseUrl)
  } catch {
    throw new Error('服务地址必须是完整的 HTTP 或 HTTPS URL')
  }
  if (
    !['http:', 'https:'].includes(baseUrl.protocol) ||
    baseUrl.username ||
    baseUrl.password ||
    baseUrl.search ||
    baseUrl.hash
  ) {
    throw new Error('服务地址仅支持 HTTP/HTTPS，且不能包含凭据、查询参数或片段')
  }
  const timeoutMs = options.timeoutMs ?? 5_000
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000) {
    throw new Error('请求超时必须是 1 至 300000 之间的整数毫秒')
  }
  const fetchRequest = options.fetch
  const validateResponses = options.validateResponses !== false

  /**
   * 发起请求并完成传输层解析；不判断业务信封。
   * @param path `/api/v1` 下的接口路径。
   * @param method GET 或 POST；POST 以 JSON 提交。
   * @param body POST 请求体。
   * @param signal 调用方取消信号。
   * @returns 已解析的 JSON 与服务端请求标识。
   * @throws 网络、超时、HTTP 状态或非法 JSON 失败时抛出 RequestError。
   */
  async function requestJson(
    path: string,
    method: 'GET' | 'POST',
    body: unknown | undefined,
    signal: AbortSignal | undefined,
    idempotencyKey?: string,
  ) {
    const url = new URL(baseUrl)
    const [pathname, queryString] = path.split('?')
    url.pathname = `${url.pathname.replace(/\/+$/, '')}${pathname ?? ''}`
    url.search = queryString ?? ''
    const timeout = AbortSignal.timeout(timeoutMs)
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout
    let response: Response
    try {
      response = await (fetchRequest ?? globalThis.fetch)(url, {
        method,
        signal: requestSignal,
        redirect: 'error',
        credentials: options.credentials ?? 'omit',
        headers: {
          accept: 'application/json',
          ...(options.token === undefined ? {} : { authorization: `Bearer ${options.token}` }),
          ...(idempotencyKey === undefined ? {} : { 'idempotency-key': idempotencyKey }),
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
    } catch (error) {
      if (signal?.aborted) throw error
      throw new RequestError(timeout.aborted ? '请求超时，请稍后重试。' : '无法连接后端，请检查服务地址和网络。', {
        code: timeout.aborted ? 'TIMEOUT' : 'NETWORK_ERROR',
      })
    }

    const headerRequestId = response.headers.get('x-request-id')
    let payload: unknown
    try {
      payload = await response.json()
    } catch (error) {
      if (signal?.aborted) throw error
      if (timeout.aborted)
        throw new RequestError('请求超时，请稍后重试。', { code: 'TIMEOUT', requestId: headerRequestId })
      throw new RequestError(
        response.ok ? '后端未返回有效 JSON。' : `服务请求失败（HTTP ${response.status}），请稍后重试。`,
        { code: response.ok ? 'INVALID_RESPONSE' : 'HTTP_ERROR', status: response.status, requestId: headerRequestId },
      )
    }

    if (!response.ok) {
      const details = validateError(payload)
        ? { responseValid: true, serverCode: payload.code }
        : { responseValid: false }
      throw new RequestError(`服务请求失败（HTTP ${response.status}），请稍后重试。`, {
        code: 'HTTP_ERROR',
        status: response.status,
        requestId: headerRequestId,
        ...details,
      })
    }

    return { payload, headerRequestId }
  }

  /**
   * 校验统一响应信封并解包成功数据。
   * @param path `/api/v1` 下的接口路径。
   * @param validate 从 OpenAPI 生成的响应校验器。
   * @param signal 调用方取消信号。
   * @returns 成功信封中的业务数据与请求标识。
   * @throws 契约错误、业务失败码或传输失败时抛出 RequestError。
   */
  async function getEnvelope<T>(
    path: string,
    validate: (value: unknown) => value is ApiSuccessEnvelope<T> | ApiFailureEnvelope,
    signal?: AbortSignal,
  ) {
    const { payload, headerRequestId } = await requestJson(path, 'GET', undefined, signal)
    if (!validate(payload)) {
      throw new RequestError('后端响应不符合接口契约。', { code: 'INVALID_RESPONSE', requestId: headerRequestId })
    }
    const requestId = headerRequestId ?? payload.requestId
    if (!payload.success) throw createBusinessError(payload, requestId)
    return { data: payload.data, requestId }
  }

  /**
   * 发起业务请求并解包统一信封；调用方显式给出成功数据类型。
   * @param path `/api/v1` 下的路径。
   * @param method GET 或 POST。
   * @param body POST 请求体。
   * @param options 取消信号、幂等键与查询参数。
   * @returns 成功数据与请求标识。
   * @throws 网络、超时、契约错误或业务失败时抛出 RequestError。
   */
  async function callTyped<T>(
    path: string,
    method: 'GET' | 'POST',
    body: unknown | undefined,
    options: ApiCallOptions & { query?: unknown } = {},
  ): Promise<{ data: T; requestId: string }> {
    const { payload, headerRequestId } = await requestJson(
      `${path}${toQueryString(options.query)}`,
      method,
      body,
      options.signal,
      options.idempotencyKey,
    )
    if (isFailureEnvelope(payload)) {
      throw createBusinessError(payload, headerRequestId ?? payload.requestId)
    }
    if (!isSuccessEnvelope(payload)) {
      throw new RequestError('后端响应不符合接口契约。', { code: 'INVALID_RESPONSE', requestId: headerRequestId })
    }
    if (validateResponses && !validateResponse(method, path, payload)) {
      throw new RequestError('后端响应不符合接口契约。', {
        code: 'INVALID_RESPONSE',
        requestId: headerRequestId ?? payload.requestId,
      })
    }
    return { data: payload.data as T, requestId: headerRequestId ?? payload.requestId }
  }

  return {
    /**
     * 读取进程存活状态，不检查数据库。
     * @param signal 调用方取消信号，覆盖连接和响应体读取。
     * @returns 已验证并筛选的存活状态及请求标识。
     * @throws 请求失败、超时、业务错误或契约错误时抛出 RequestError；主动取消向上传递。
     */
    async health(signal?: AbortSignal) {
      const result = await getEnvelope<{ status: 'ok' }>('/api/v1/health', validateHealth, signal)
      return { ...result, data: { status: result.data.status } }
    },
    /**
     * 读取数据库就绪状态。
     * @param signal 调用方取消信号，覆盖连接和响应体读取。
     * @returns 已验证并筛选的就绪状态及请求标识。
     * @throws 请求失败、超时、业务错误或契约错误时抛出 RequestError；主动取消向上传递。
     */
    async ready(signal?: AbortSignal) {
      const result = await getEnvelope<ReadinessResponse>('/api/v1/ready', validateReadiness, signal)
      return { ...result, data: { status: result.data.status, database: result.data.database } }
    },

    /** 读取当前身份与可用团队（API Token 或 Cookie 会话均可）。 */
    async me(options: ApiCallOptions = {}) {
      return callTyped<ApiSuccessData<'/api/v1/me', 'get'>>('/api/v1/me', 'GET', undefined, options)
    },
    /** 读取当前账号的 API Token 元数据。 */
    async listApiTokens(options: ApiCallOptions = {}) {
      return callTyped<ApiSuccessData<'/api/v1/me/tokens', 'get'>>('/api/v1/me/tokens', 'GET', undefined, options)
    },
    /** 创建 API Token；响应中的明文只出现一次。 */
    async createApiToken(body: ApiBody<'/api/v1/me/tokens', 'post'>, options: ApiCallOptions = {}) {
      return callTyped<ApiSuccessData<'/api/v1/me/tokens', 'post'>>('/api/v1/me/tokens', 'POST', body, options)
    },
    /** 撤销指定 API Token。 */
    async revokeApiToken(tokenId: string, options: ApiCallOptions = {}) {
      return callTyped<ApiSuccessData<'/api/v1/me/tokens/{tokenId}/revoke', 'post'>>(
        `/api/v1/me/tokens/${segment(tokenId)}/revoke`,
        'POST',
        undefined,
        options,
      )
    },

    /** 读取当前用户加入的团队。 */
    async listMyTeams(options: ApiCallOptions = {}) {
      return callTyped<ApiSuccessData<'/api/v1/me/teams', 'get'>>('/api/v1/me/teams', 'GET', undefined, options)
    },
    /** 由平台 root 创建团队并邀请管理员。 */
    async createTeam(body: ApiBody<'/api/v1/platform/teams', 'post'>, options: ApiCallOptions = {}) {
      return callTyped<ApiSuccessData<'/api/v1/platform/teams', 'post'>>(
        '/api/v1/platform/teams',
        'POST',
        body,
        options,
      )
    },
    /** 读取团队成员。 */
    async listTeamMembers(teamId: string, options: ApiCallOptions = {}) {
      return callTyped<ApiSuccessData<'/api/v1/teams/{teamId}/members', 'get'>>(
        `/api/v1/teams/${segment(teamId)}/members`,
        'GET',
        undefined,
        options,
      )
    },
    /** 更新成员角色或状态。 */
    async updateTeamMember(
      teamId: string,
      userId: string,
      body: ApiBody<'/api/v1/teams/{teamId}/members/{userId}/update', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/teams/{teamId}/members/{userId}/update', 'post'>>(
        `/api/v1/teams/${segment(teamId)}/members/${segment(userId)}/update`,
        'POST',
        body,
        options,
      )
    },
    /** 读取团队项目首页活动晴雨表与项目摘要。 */
    async getProjectActivity(
      teamId: string,
      query?: ApiQuery<'/api/v1/teams/{teamId}/project-activity', 'get'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/teams/{teamId}/project-activity', 'get'>>(
        `/api/v1/teams/${segment(teamId)}/project-activity`,
        'GET',
        undefined,
        { ...options, query },
      )
    },

    /** 读取团队邀请。 */
    async listTeamInvitations(
      teamId: string,
      query?: ApiQuery<'/api/v1/teams/{teamId}/invitations', 'get'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/teams/{teamId}/invitations', 'get'>>(
        `/api/v1/teams/${segment(teamId)}/invitations`,
        'GET',
        undefined,
        { ...options, query },
      )
    },
    /** 邀请成员加入团队。 */
    async inviteTeamMember(
      teamId: string,
      body: ApiBody<'/api/v1/teams/{teamId}/invitations', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/teams/{teamId}/invitations', 'post'>>(
        `/api/v1/teams/${segment(teamId)}/invitations`,
        'POST',
        body,
        options,
      )
    },
    /** 重发邀请。 */
    async resendInvitation(teamId: string, invitationId: string, options: ApiCallOptions = {}) {
      return callTyped<ApiSuccessData<'/api/v1/teams/{teamId}/invitations/{invitationId}/resend', 'post'>>(
        `/api/v1/teams/${segment(teamId)}/invitations/${segment(invitationId)}/resend`,
        'POST',
        undefined,
        options,
      )
    },
    /** 撤销邀请。 */
    async revokeInvitation(teamId: string, invitationId: string, options: ApiCallOptions = {}) {
      return callTyped<ApiSuccessData<'/api/v1/teams/{teamId}/invitations/{invitationId}/revoke', 'post'>>(
        `/api/v1/teams/${segment(teamId)}/invitations/${segment(invitationId)}/revoke`,
        'POST',
        undefined,
        options,
      )
    },
    /** 读取邀请详情。 */
    async getInvitation(token: string, options: ApiCallOptions = {}) {
      return callTyped<ApiSuccessData<'/api/v1/invitations/{token}', 'get'>>(
        `/api/v1/invitations/${segment(token)}`,
        'GET',
        undefined,
        options,
      )
    },
    /** 接受邀请并创建/登录账号。 */
    async acceptInvitation(
      token: string,
      body: ApiBody<'/api/v1/invitations/{token}/accept', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/invitations/{token}/accept', 'post'>>(
        `/api/v1/invitations/${segment(token)}/accept`,
        'POST',
        body,
        options,
      )
    },

    /** 读取团队项目列表。 */
    async listProjects(
      teamId: string,
      query?: ApiQuery<'/api/v1/teams/{teamId}/projects', 'get'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/teams/{teamId}/projects', 'get'>>(
        `/api/v1/teams/${segment(teamId)}/projects`,
        'GET',
        undefined,
        { ...options, query },
      )
    },
    /** 创建项目。 */
    async createProject(
      teamId: string,
      body: ApiBody<'/api/v1/teams/{teamId}/projects', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/teams/{teamId}/projects', 'post'>>(
        `/api/v1/teams/${segment(teamId)}/projects`,
        'POST',
        body,
        options,
      )
    },
    /** 读取项目详情。 */
    async getProject(projectId: string, options: ApiCallOptions = {}) {
      return callTyped<ApiSuccessData<'/api/v1/projects/{projectId}', 'get'>>(
        `/api/v1/projects/${segment(projectId)}`,
        'GET',
        undefined,
        options,
      )
    },
    /** 更新项目。 */
    async updateProject(
      projectId: string,
      body: ApiBody<'/api/v1/projects/{projectId}/update', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/projects/{projectId}/update', 'post'>>(
        `/api/v1/projects/${segment(projectId)}/update`,
        'POST',
        body,
        options,
      )
    },
    /** 读取项目统计。 */
    async getProjectStats(projectId: string, options: ApiCallOptions = {}) {
      return callTyped<ApiSuccessData<'/api/v1/projects/{projectId}/stats', 'get'>>(
        `/api/v1/projects/${segment(projectId)}/stats`,
        'GET',
        undefined,
        options,
      )
    },

    /** 上报构建与产物引用（CLI/Web 共用）。 */
    async reportBuild(
      projectId: string,
      body: ApiBody<'/api/v1/projects/{projectId}/builds', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/projects/{projectId}/builds', 'post'>>(
        `/api/v1/projects/${segment(projectId)}/builds`,
        'POST',
        body,
        options,
      )
    },
    /** 读取项目构建记录列表。 */
    async listBuilds(
      projectId: string,
      query?: ApiQuery<'/api/v1/projects/{projectId}/builds', 'get'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/projects/{projectId}/builds', 'get'>>(
        `/api/v1/projects/${segment(projectId)}/builds`,
        'GET',
        undefined,
        { ...options, query },
      )
    },
    /** 读取构建记录详情。 */
    async getBuild(buildId: string, options: ApiCallOptions = {}) {
      return callTyped<ApiSuccessData<'/api/v1/builds/{buildId}', 'get'>>(
        `/api/v1/builds/${segment(buildId)}`,
        'GET',
        undefined,
        options,
      )
    },
    /** 读取项目流水线运行列表。 */
    async listPipelineRuns(
      projectId: string,
      query?: ApiQuery<'/api/v1/projects/{projectId}/pipeline-runs', 'get'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/projects/{projectId}/pipeline-runs', 'get'>>(
        `/api/v1/projects/${segment(projectId)}/pipeline-runs`,
        'GET',
        undefined,
        { ...options, query },
      )
    },
    /** 读取流水线运行详情。 */
    async getPipelineRun(runId: string, options: ApiCallOptions = {}) {
      return callTyped<ApiSuccessData<'/api/v1/pipeline-runs/{runId}', 'get'>>(
        `/api/v1/pipeline-runs/${segment(runId)}`,
        'GET',
        undefined,
        options,
      )
    },
    /** 更正构建记录。 */
    async correctBuild(
      buildId: string,
      body: ApiBody<'/api/v1/builds/{buildId}/correct', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/builds/{buildId}/correct', 'post'>>(
        `/api/v1/builds/${segment(buildId)}/correct`,
        'POST',
        body,
        options,
      )
    },
    /** 补报构建产物引用。 */
    async addBuildArtifact(
      buildId: string,
      body: ApiBody<'/api/v1/builds/{buildId}/artifacts', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/builds/{buildId}/artifacts', 'post'>>(
        `/api/v1/builds/${segment(buildId)}/artifacts`,
        'POST',
        body,
        options,
      )
    },
    /** 关联构建与需求/Bug。 */
    async linkBuildTarget(
      buildId: string,
      body: ApiBody<'/api/v1/builds/{buildId}/targets', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/builds/{buildId}/targets', 'post'>>(
        `/api/v1/builds/${segment(buildId)}/targets`,
        'POST',
        body,
        options,
      )
    },
    /** 解除构建与需求/Bug 的关联。 */
    async unlinkBuildTarget(
      buildId: string,
      targetId: string,
      body: ApiBody<'/api/v1/builds/{buildId}/targets/{targetId}/remove', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/builds/{buildId}/targets/{targetId}/remove', 'post'>>(
        `/api/v1/builds/${segment(buildId)}/targets/${segment(targetId)}/remove`,
        'POST',
        body,
        options,
      )
    },

    /** 读取项目需求列表。 */
    async listRequirements(
      projectId: string,
      query?: ApiQuery<'/api/v1/projects/{projectId}/requirements', 'get'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/projects/{projectId}/requirements', 'get'>>(
        `/api/v1/projects/${segment(projectId)}/requirements`,
        'GET',
        undefined,
        { ...options, query },
      )
    },
    /** 创建需求。 */
    async createRequirement(
      projectId: string,
      body: ApiBody<'/api/v1/projects/{projectId}/requirements', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/projects/{projectId}/requirements', 'post'>>(
        `/api/v1/projects/${segment(projectId)}/requirements`,
        'POST',
        body,
        options,
      )
    },
    /** 读取需求详情。 */
    async getRequirement(requirementId: string, options: ApiCallOptions = {}) {
      return callTyped<ApiSuccessData<'/api/v1/requirements/{requirementId}', 'get'>>(
        `/api/v1/requirements/${segment(requirementId)}`,
        'GET',
        undefined,
        options,
      )
    },
    /** 更新需求。 */
    async updateRequirement(
      requirementId: string,
      body: ApiBody<'/api/v1/requirements/{requirementId}/update', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/requirements/{requirementId}/update', 'post'>>(
        `/api/v1/requirements/${segment(requirementId)}/update`,
        'POST',
        body,
        options,
      )
    },
    /** 读取需求评论。 */
    async listRequirementComments(
      requirementId: string,
      query?: ApiQuery<'/api/v1/requirements/{requirementId}/comments', 'get'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/requirements/{requirementId}/comments', 'get'>>(
        `/api/v1/requirements/${segment(requirementId)}/comments`,
        'GET',
        undefined,
        { ...options, query },
      )
    },
    /** 新增需求评论。 */
    async addRequirementComment(
      requirementId: string,
      body: ApiBody<'/api/v1/requirements/{requirementId}/comments', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/requirements/{requirementId}/comments', 'post'>>(
        `/api/v1/requirements/${segment(requirementId)}/comments`,
        'POST',
        body,
        options,
      )
    },
    /** 读取需求活动。 */
    async listRequirementActivities(
      requirementId: string,
      query?: ApiQuery<'/api/v1/requirements/{requirementId}/activities', 'get'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/requirements/{requirementId}/activities', 'get'>>(
        `/api/v1/requirements/${segment(requirementId)}/activities`,
        'GET',
        undefined,
        { ...options, query },
      )
    },
    /** 需求开始开发。 */
    async startRequirementDevelopment(
      requirementId: string,
      body: ApiBody<'/api/v1/requirements/{requirementId}/start-development', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/requirements/{requirementId}/start-development', 'post'>>(
        `/api/v1/requirements/${segment(requirementId)}/start-development`,
        'POST',
        body,
        options,
      )
    },
    /** 需求提测。 */
    async submitRequirementTest(
      requirementId: string,
      body: ApiBody<'/api/v1/requirements/{requirementId}/submit-test', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/requirements/{requirementId}/submit-test', 'post'>>(
        `/api/v1/requirements/${segment(requirementId)}/submit-test`,
        'POST',
        body,
        options,
      )
    },
    /** 需求开始测试。 */
    async startRequirementTest(
      requirementId: string,
      body: ApiBody<'/api/v1/requirements/{requirementId}/start-test', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/requirements/{requirementId}/start-test', 'post'>>(
        `/api/v1/requirements/${segment(requirementId)}/start-test`,
        'POST',
        body,
        options,
      )
    },
    /** 需求撤回测试。 */
    async withdrawRequirementTest(
      requirementId: string,
      body: ApiBody<'/api/v1/requirements/{requirementId}/withdraw-test', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/requirements/{requirementId}/withdraw-test', 'post'>>(
        `/api/v1/requirements/${segment(requirementId)}/withdraw-test`,
        'POST',
        body,
        options,
      )
    },
    /** 需求退回开发。 */
    async returnRequirementToDevelopment(
      requirementId: string,
      body: ApiBody<'/api/v1/requirements/{requirementId}/return-to-development', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/requirements/{requirementId}/return-to-development', 'post'>>(
        `/api/v1/requirements/${segment(requirementId)}/return-to-development`,
        'POST',
        body,
        options,
      )
    },
    /** 查询需求测试通过资格。 */
    async getRequirementTestPassEligibility(requirementId: string, options: ApiCallOptions = {}) {
      return callTyped<ApiSuccessData<'/api/v1/requirements/{requirementId}/test-pass-eligibility', 'get'>>(
        `/api/v1/requirements/${segment(requirementId)}/test-pass-eligibility`,
        'GET',
        undefined,
        options,
      )
    },
    /** 需求测试通过。 */
    async passRequirementTest(
      requirementId: string,
      body: ApiBody<'/api/v1/requirements/{requirementId}/pass-test', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/requirements/{requirementId}/pass-test', 'post'>>(
        `/api/v1/requirements/${segment(requirementId)}/pass-test`,
        'POST',
        body,
        options,
      )
    },
    /** 需求重新开发。 */
    async reopenRequirementDevelopment(
      requirementId: string,
      body: ApiBody<'/api/v1/requirements/{requirementId}/reopen-development', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/requirements/{requirementId}/reopen-development', 'post'>>(
        `/api/v1/requirements/${segment(requirementId)}/reopen-development`,
        'POST',
        body,
        options,
      )
    },
    /** 取消需求。 */
    async cancelRequirement(
      requirementId: string,
      body: ApiBody<'/api/v1/requirements/{requirementId}/cancel', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/requirements/{requirementId}/cancel', 'post'>>(
        `/api/v1/requirements/${segment(requirementId)}/cancel`,
        'POST',
        body,
        options,
      )
    },
    /** 恢复已取消需求。 */
    async restoreRequirement(
      requirementId: string,
      body: ApiBody<'/api/v1/requirements/{requirementId}/restore', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/requirements/{requirementId}/restore', 'post'>>(
        `/api/v1/requirements/${segment(requirementId)}/restore`,
        'POST',
        body,
        options,
      )
    },
    /** 读取需求提测历史。 */
    async listRequirementTestSubmissions(
      requirementId: string,
      query?: ApiQuery<'/api/v1/requirements/{requirementId}/test-submissions', 'get'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/requirements/{requirementId}/test-submissions', 'get'>>(
        `/api/v1/requirements/${segment(requirementId)}/test-submissions`,
        'GET',
        undefined,
        { ...options, query },
      )
    },

    /** 读取项目 Bug 列表。 */
    async listBugs(
      projectId: string,
      query?: ApiQuery<'/api/v1/projects/{projectId}/bugs', 'get'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/projects/{projectId}/bugs', 'get'>>(
        `/api/v1/projects/${segment(projectId)}/bugs`,
        'GET',
        undefined,
        { ...options, query },
      )
    },
    /** 创建 Bug。 */
    async createBug(
      projectId: string,
      body: ApiBody<'/api/v1/projects/{projectId}/bugs', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/projects/{projectId}/bugs', 'post'>>(
        `/api/v1/projects/${segment(projectId)}/bugs`,
        'POST',
        body,
        options,
      )
    },
    /** 读取 Bug 详情。 */
    async getBug(bugId: string, options: ApiCallOptions = {}) {
      return callTyped<ApiSuccessData<'/api/v1/bugs/{bugId}', 'get'>>(
        `/api/v1/bugs/${segment(bugId)}`,
        'GET',
        undefined,
        options,
      )
    },
    /** 更新 Bug。 */
    async updateBug(bugId: string, body: ApiBody<'/api/v1/bugs/{bugId}/update', 'post'>, options: ApiCallOptions = {}) {
      return callTyped<ApiSuccessData<'/api/v1/bugs/{bugId}/update', 'post'>>(
        `/api/v1/bugs/${segment(bugId)}/update`,
        'POST',
        body,
        options,
      )
    },
    /** Bug 开始修复。 */
    async startBugFix(
      bugId: string,
      body: ApiBody<'/api/v1/bugs/{bugId}/start-fix', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/bugs/{bugId}/start-fix', 'post'>>(
        `/api/v1/bugs/${segment(bugId)}/start-fix`,
        'POST',
        body,
        options,
      )
    },
    /** 提交 Bug 回归。 */
    async submitBugRegression(
      bugId: string,
      body: ApiBody<'/api/v1/bugs/{bugId}/submit-regression', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/bugs/{bugId}/submit-regression', 'post'>>(
        `/api/v1/bugs/${segment(bugId)}/submit-regression`,
        'POST',
        body,
        options,
      )
    },
    /** 撤回 Bug 回归。 */
    async withdrawBugRegression(
      bugId: string,
      body: ApiBody<'/api/v1/bugs/{bugId}/withdraw-regression', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/bugs/{bugId}/withdraw-regression', 'post'>>(
        `/api/v1/bugs/${segment(bugId)}/withdraw-regression`,
        'POST',
        body,
        options,
      )
    },
    /** 记录 Bug 回归结论。 */
    async recordBugRegression(
      bugId: string,
      body: ApiBody<'/api/v1/bugs/{bugId}/record-regression', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/bugs/{bugId}/record-regression', 'post'>>(
        `/api/v1/bugs/${segment(bugId)}/record-regression`,
        'POST',
        body,
        options,
      )
    },
    /** 关闭 Bug。 */
    async closeBug(bugId: string, body: ApiBody<'/api/v1/bugs/{bugId}/close', 'post'>, options: ApiCallOptions = {}) {
      return callTyped<ApiSuccessData<'/api/v1/bugs/{bugId}/close', 'post'>>(
        `/api/v1/bugs/${segment(bugId)}/close`,
        'POST',
        body,
        options,
      )
    },
    /** 重开 Bug。 */
    async reopenBug(bugId: string, body: ApiBody<'/api/v1/bugs/{bugId}/reopen', 'post'>, options: ApiCallOptions = {}) {
      return callTyped<ApiSuccessData<'/api/v1/bugs/{bugId}/reopen', 'post'>>(
        `/api/v1/bugs/${segment(bugId)}/reopen`,
        'POST',
        body,
        options,
      )
    },
    /** 关联 Bug 与需求。 */
    async linkBugRequirement(
      bugId: string,
      body: ApiBody<'/api/v1/bugs/{bugId}/requirements', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/bugs/{bugId}/requirements', 'post'>>(
        `/api/v1/bugs/${segment(bugId)}/requirements`,
        'POST',
        body,
        options,
      )
    },
    /** 移除 Bug 与需求关联。 */
    async unlinkBugRequirement(
      bugId: string,
      requirementId: string,
      body: ApiBody<'/api/v1/bugs/{bugId}/requirements/{requirementId}/remove', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/bugs/{bugId}/requirements/{requirementId}/remove', 'post'>>(
        `/api/v1/bugs/${segment(bugId)}/requirements/${segment(requirementId)}/remove`,
        'POST',
        body,
        options,
      )
    },
    /** 读取 Bug 评论。 */
    async listBugComments(
      bugId: string,
      query?: ApiQuery<'/api/v1/bugs/{bugId}/comments', 'get'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/bugs/{bugId}/comments', 'get'>>(
        `/api/v1/bugs/${segment(bugId)}/comments`,
        'GET',
        undefined,
        { ...options, query },
      )
    },
    /** 新增 Bug 评论。 */
    async addBugComment(
      bugId: string,
      body: ApiBody<'/api/v1/bugs/{bugId}/comments', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/bugs/{bugId}/comments', 'post'>>(
        `/api/v1/bugs/${segment(bugId)}/comments`,
        'POST',
        body,
        options,
      )
    },
    /** 读取 Bug 活动。 */
    async listBugActivities(
      bugId: string,
      query?: ApiQuery<'/api/v1/bugs/{bugId}/activities', 'get'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/bugs/{bugId}/activities', 'get'>>(
        `/api/v1/bugs/${segment(bugId)}/activities`,
        'GET',
        undefined,
        { ...options, query },
      )
    },

    /** 读取项目已关联仓库。 */
    async listProjectRepositories(projectId: string, options: ApiCallOptions = {}) {
      return callTyped<ApiSuccessData<'/api/v1/projects/{projectId}/repositories', 'get'>>(
        `/api/v1/projects/${segment(projectId)}/repositories`,
        'GET',
        undefined,
        options,
      )
    },
    /** 读取可关联仓库。 */
    async listAvailableRepositories(
      projectId: string,
      query?: ApiQuery<'/api/v1/projects/{projectId}/repositories/available', 'get'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/projects/{projectId}/repositories/available', 'get'>>(
        `/api/v1/projects/${segment(projectId)}/repositories/available`,
        'GET',
        undefined,
        { ...options, query },
      )
    },
    /** 读取仓库分支列表。 */
    async listRepositoryBranches(projectId: string, repositoryId: string, options: ApiCallOptions = {}) {
      return callTyped<ApiSuccessData<'/api/v1/projects/{projectId}/repositories/{repositoryId}/branches', 'get'>>(
        `/api/v1/projects/${segment(projectId)}/repositories/${segment(repositoryId)}/branches`,
        'GET',
        undefined,
        options,
      )
    },
    /** 读取仓库文件树。 */
    async listRepositoryTree(
      projectId: string,
      repositoryId: string,
      query?: ApiQuery<'/api/v1/projects/{projectId}/repositories/{repositoryId}/tree', 'get'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/projects/{projectId}/repositories/{repositoryId}/tree', 'get'>>(
        `/api/v1/projects/${segment(projectId)}/repositories/${segment(repositoryId)}/tree`,
        'GET',
        undefined,
        { ...options, query },
      )
    },
    /** 读取仓库文件内容。 */
    async getRepositoryFile(
      projectId: string,
      repositoryId: string,
      query: ApiQuery<'/api/v1/projects/{projectId}/repositories/{repositoryId}/file', 'get'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/projects/{projectId}/repositories/{repositoryId}/file', 'get'>>(
        `/api/v1/projects/${segment(projectId)}/repositories/${segment(repositoryId)}/file`,
        'GET',
        undefined,
        { ...options, query },
      )
    },
    /** 关联仓库到项目。 */
    async linkRepository(
      projectId: string,
      body: ApiBody<'/api/v1/projects/{projectId}/repositories', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/projects/{projectId}/repositories', 'post'>>(
        `/api/v1/projects/${segment(projectId)}/repositories`,
        'POST',
        body,
        options,
      )
    },
    /** 移除项目仓库关联。 */
    async unlinkRepository(
      projectId: string,
      repositoryId: string,
      body: ApiBody<'/api/v1/projects/{projectId}/repositories/{repositoryId}/remove', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/projects/{projectId}/repositories/{repositoryId}/remove', 'post'>>(
        `/api/v1/projects/${segment(projectId)}/repositories/${segment(repositoryId)}/remove`,
        'POST',
        body,
        options,
      )
    },
    /** 创建代码引用。 */
    async createCodeReference(
      projectId: string,
      body: ApiBody<'/api/v1/projects/{projectId}/code-references', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/projects/{projectId}/code-references', 'post'>>(
        `/api/v1/projects/${segment(projectId)}/code-references`,
        'POST',
        body,
        options,
      )
    },
    /** 刷新代码引用。 */
    async refreshCodeReference(codeReferenceId: string, options: ApiCallOptions = {}) {
      return callTyped<ApiSuccessData<'/api/v1/code-references/{codeReferenceId}/refresh', 'post'>>(
        `/api/v1/code-references/${segment(codeReferenceId)}/refresh`,
        'POST',
        undefined,
        options,
      )
    },
    /** 移除代码引用。 */
    async removeCodeReference(
      codeReferenceId: string,
      body: ApiBody<'/api/v1/code-references/{codeReferenceId}/remove', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/code-references/{codeReferenceId}/remove', 'post'>>(
        `/api/v1/code-references/${segment(codeReferenceId)}/remove`,
        'POST',
        body,
        options,
      )
    },

    /** 读取 Git 提供方。 */
    async listGitProviders(options: ApiCallOptions = {}) {
      return callTyped<ApiSuccessData<'/api/v1/git-providers', 'get'>>(
        '/api/v1/git-providers',
        'GET',
        undefined,
        options,
      )
    },
    /** 读取团队 Git 连接。 */
    async listGitConnections(teamId: string, options: ApiCallOptions = {}) {
      return callTyped<ApiSuccessData<'/api/v1/teams/{teamId}/git-connections', 'get'>>(
        `/api/v1/teams/${segment(teamId)}/git-connections`,
        'GET',
        undefined,
        options,
      )
    },
    /** 创建 Git 连接或获取 GitHub 授权地址。 */
    async createGitConnection(
      teamId: string,
      body: ApiBody<'/api/v1/teams/{teamId}/git-connections', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/teams/{teamId}/git-connections', 'post'>>(
        `/api/v1/teams/${segment(teamId)}/git-connections`,
        'POST',
        body,
        options,
      )
    },
    /** 检查 Git 连接。 */
    async checkGitConnection(connectionId: string, options: ApiCallOptions = {}) {
      return callTyped<ApiSuccessData<'/api/v1/git-connections/{connectionId}/check', 'post'>>(
        `/api/v1/git-connections/${segment(connectionId)}/check`,
        'POST',
        undefined,
        options,
      )
    },
    /** 同步 Git 仓库。 */
    async syncGitRepositories(connectionId: string, options: ApiCallOptions = {}) {
      return callTyped<ApiSuccessData<'/api/v1/git-connections/{connectionId}/sync-repositories', 'post'>>(
        `/api/v1/git-connections/${segment(connectionId)}/sync-repositories`,
        'POST',
        undefined,
        options,
      )
    },
    /** 读取连接仓库。 */
    async listGitConnectionRepositories(
      connectionId: string,
      query?: ApiQuery<'/api/v1/git-connections/{connectionId}/repositories', 'get'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/git-connections/{connectionId}/repositories', 'get'>>(
        `/api/v1/git-connections/${segment(connectionId)}/repositories`,
        'GET',
        undefined,
        { ...options, query },
      )
    },
    /** 撤销 Git 连接。 */
    async revokeGitConnection(
      connectionId: string,
      body: ApiBody<'/api/v1/git-connections/{connectionId}/revoke', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/git-connections/{connectionId}/revoke', 'post'>>(
        `/api/v1/git-connections/${segment(connectionId)}/revoke`,
        'POST',
        body,
        options,
      )
    },

    /** 更新团队资料（名称/图标标识/说明）。 */
    async updateTeam(
      teamId: string,
      body: ApiBody<'/api/v1/teams/{teamId}/update', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/teams/{teamId}/update', 'post'>>(
        `/api/v1/teams/${segment(teamId)}/update`,
        'POST',
        body,
        options,
      )
    },

    /** 读取项目服务目录。 */
    async listProjectServices(projectId: string, options: ApiCallOptions = {}) {
      return callTyped<ApiSuccessData<'/api/v1/projects/{projectId}/services', 'get'>>(
        `/api/v1/projects/${segment(projectId)}/services`,
        'GET',
        undefined,
        options,
      )
    },
    /** 读取项目服务详情。 */
    async getProjectService(projectId: string, serviceId: string, options: ApiCallOptions = {}) {
      return callTyped<ApiSuccessData<'/api/v1/projects/{projectId}/services/{serviceId}', 'get'>>(
        `/api/v1/projects/${segment(projectId)}/services/${segment(serviceId)}`,
        'GET',
        undefined,
        options,
      )
    },
    /** 创建项目服务并可选关联仓库。 */
    async createProjectService(
      projectId: string,
      body: ApiBody<'/api/v1/projects/{projectId}/services', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/projects/{projectId}/services', 'post'>>(
        `/api/v1/projects/${segment(projectId)}/services`,
        'POST',
        body,
        options,
      )
    },
    /** 更新项目服务资料或状态。 */
    async updateProjectService(
      projectId: string,
      serviceId: string,
      body: ApiBody<'/api/v1/projects/{projectId}/services/{serviceId}/update', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/projects/{projectId}/services/{serviceId}/update', 'post'>>(
        `/api/v1/projects/${segment(projectId)}/services/${segment(serviceId)}/update`,
        'POST',
        body,
        options,
      )
    },
    /** 为服务关联仓库。 */
    async addServiceRepository(
      projectId: string,
      serviceId: string,
      body: ApiBody<'/api/v1/projects/{projectId}/services/{serviceId}/repositories', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/projects/{projectId}/services/{serviceId}/repositories', 'post'>>(
        `/api/v1/projects/${segment(projectId)}/services/${segment(serviceId)}/repositories`,
        'POST',
        body,
        options,
      )
    },
    /** 解除服务与仓库关联。 */
    async removeServiceRepository(
      projectId: string,
      serviceId: string,
      repositoryId: string,
      body: ApiBody<'/api/v1/projects/{projectId}/services/{serviceId}/repositories/{repositoryId}/remove', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<
        ApiSuccessData<'/api/v1/projects/{projectId}/services/{serviceId}/repositories/{repositoryId}/remove', 'post'>
      >(
        `/api/v1/projects/${segment(projectId)}/services/${segment(serviceId)}/repositories/${segment(repositoryId)}/remove`,
        'POST',
        body,
        options,
      )
    },

    /** 读取项目产物入口。 */
    async listProjectArtifacts(
      projectId: string,
      query?: ApiQuery<'/api/v1/projects/{projectId}/artifacts', 'get'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/projects/{projectId}/artifacts', 'get'>>(
        `/api/v1/projects/${segment(projectId)}/artifacts`,
        'GET',
        undefined,
        { ...options, query },
      )
    },
    /** 读取服务各环境运行版本。 */
    async listRunVersions(projectId: string, serviceId: string, options: ApiCallOptions = {}) {
      return callTyped<ApiSuccessData<'/api/v1/projects/{projectId}/services/{serviceId}/run-versions', 'get'>>(
        `/api/v1/projects/${segment(projectId)}/services/${segment(serviceId)}/run-versions`,
        'GET',
        undefined,
        options,
      )
    },
    /** 读取运行版本历史。 */
    async listRunVersionHistory(
      projectId: string,
      serviceId: string,
      environment: string,
      query?: ApiQuery<'/api/v1/projects/{projectId}/services/{serviceId}/run-versions/{environment}/history', 'get'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<
        ApiSuccessData<'/api/v1/projects/{projectId}/services/{serviceId}/run-versions/{environment}/history', 'get'>
      >(
        `/api/v1/projects/${segment(projectId)}/services/${segment(serviceId)}/run-versions/${segment(environment)}/history`,
        'GET',
        undefined,
        { ...options, query },
      )
    },
    /** 确认或更正服务运行版本。 */
    async confirmRunVersion(
      projectId: string,
      serviceId: string,
      environment: string,
      body: ApiBody<'/api/v1/projects/{projectId}/services/{serviceId}/run-versions/{environment}/confirm', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<
        ApiSuccessData<'/api/v1/projects/{projectId}/services/{serviceId}/run-versions/{environment}/confirm', 'post'>
      >(
        `/api/v1/projects/${segment(projectId)}/services/${segment(serviceId)}/run-versions/${segment(environment)}/confirm`,
        'POST',
        body,
        options,
      )
    },
    /** 创建外部提审记录。 */
    async createReview(
      projectId: string,
      body: ApiBody<'/api/v1/projects/{projectId}/reviews', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/projects/{projectId}/reviews', 'post'>>(
        `/api/v1/projects/${segment(projectId)}/reviews`,
        'POST',
        body,
        options,
      )
    },
    /** 更新审核状态。 */
    async updateReview(
      reviewId: string,
      body: ApiBody<'/api/v1/reviews/{reviewId}/update', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/reviews/{reviewId}/update', 'post'>>(
        `/api/v1/reviews/${segment(reviewId)}/update`,
        'POST',
        body,
        options,
      )
    },
    /** 读取项目提审列表。 */
    async listReviews(
      projectId: string,
      query?: ApiQuery<'/api/v1/projects/{projectId}/reviews', 'get'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/projects/{projectId}/reviews', 'get'>>(
        `/api/v1/projects/${segment(projectId)}/reviews`,
        'GET',
        undefined,
        { ...options, query },
      )
    },
    /** 读取提审详情。 */
    async getReview(reviewId: string, options: ApiCallOptions = {}) {
      return callTyped<ApiSuccessData<'/api/v1/reviews/{reviewId}', 'get'>>(
        `/api/v1/reviews/${segment(reviewId)}`,
        'GET',
        undefined,
        options,
      )
    },
    /** 记录实际发布结果。 */
    async createRelease(
      projectId: string,
      body: ApiBody<'/api/v1/projects/{projectId}/releases', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/projects/{projectId}/releases', 'post'>>(
        `/api/v1/projects/${segment(projectId)}/releases`,
        'POST',
        body,
        options,
      )
    },
    /** 读取发布结果列表。 */
    async listReleases(
      projectId: string,
      query?: ApiQuery<'/api/v1/projects/{projectId}/releases', 'get'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/projects/{projectId}/releases', 'get'>>(
        `/api/v1/projects/${segment(projectId)}/releases`,
        'GET',
        undefined,
        { ...options, query },
      )
    },

    /** 读取团队凭据列表。 */
    async listCredentials(
      teamId: string,
      query?: ApiQuery<'/api/v1/teams/{teamId}/credentials', 'get'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/teams/{teamId}/credentials', 'get'>>(
        `/api/v1/teams/${segment(teamId)}/credentials`,
        'GET',
        undefined,
        { ...options, query },
      )
    },
    /** 读取凭据详情。 */
    async getCredential(teamId: string, credentialId: string, options: ApiCallOptions = {}) {
      return callTyped<ApiSuccessData<'/api/v1/teams/{teamId}/credentials/{credentialId}', 'get'>>(
        `/api/v1/teams/${segment(teamId)}/credentials/${segment(credentialId)}`,
        'GET',
        undefined,
        options,
      )
    },
    /** 创建团队凭据。 */
    async createCredential(
      teamId: string,
      body: ApiBody<'/api/v1/teams/{teamId}/credentials', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/teams/{teamId}/credentials', 'post'>>(
        `/api/v1/teams/${segment(teamId)}/credentials`,
        'POST',
        body,
        options,
      )
    },
    /** 轮换凭据。 */
    async rotateCredential(
      credentialId: string,
      body: ApiBody<'/api/v1/credentials/{credentialId}/rotate', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/credentials/{credentialId}/rotate', 'post'>>(
        `/api/v1/credentials/${segment(credentialId)}/rotate`,
        'POST',
        body,
        options,
      )
    },
    /** 输入登录密码后查看凭据明文；响应不可缓存，明文不落库。 */
    async revealCredentialValue(
      credentialId: string,
      body: ApiBody<'/api/v1/credentials/{credentialId}/reveal-value', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/credentials/{credentialId}/reveal-value', 'post'>>(
        `/api/v1/credentials/${segment(credentialId)}/reveal-value`,
        'POST',
        body,
        options,
      )
    },
    /** 撤销凭据。 */
    async revokeCredential(
      credentialId: string,
      body: ApiBody<'/api/v1/credentials/{credentialId}/revoke', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/credentials/{credentialId}/revoke', 'post'>>(
        `/api/v1/credentials/${segment(credentialId)}/revoke`,
        'POST',
        body,
        options,
      )
    },
    /** 授权凭据给项目。 */
    async grantCredential(
      credentialId: string,
      body: ApiBody<'/api/v1/credentials/{credentialId}/grants', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/credentials/{credentialId}/grants', 'post'>>(
        `/api/v1/credentials/${segment(credentialId)}/grants`,
        'POST',
        body,
        options,
      )
    },
    /** 撤销凭据的项目授权。 */
    async revokeCredentialGrant(
      credentialId: string,
      projectId: string,
      body: ApiBody<'/api/v1/credentials/{credentialId}/grants/{projectId}/revoke', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/credentials/{credentialId}/grants/{projectId}/revoke', 'post'>>(
        `/api/v1/credentials/${segment(credentialId)}/grants/${segment(projectId)}/revoke`,
        'POST',
        body,
        options,
      )
    },
    /** 读取凭据使用记录。 */
    async listCredentialUsage(
      credentialId: string,
      query?: ApiQuery<'/api/v1/credentials/{credentialId}/usage', 'get'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/credentials/{credentialId}/usage', 'get'>>(
        `/api/v1/credentials/${segment(credentialId)}/usage`,
        'GET',
        undefined,
        { ...options, query },
      )
    },
    /** 读取项目环境变量。 */
    async listEnvVariables(projectId: string, environment: string, options: ApiCallOptions = {}) {
      return callTyped<ApiSuccessData<'/api/v1/projects/{projectId}/environments/{environment}/variables', 'get'>>(
        `/api/v1/projects/${segment(projectId)}/environments/${segment(environment)}/variables`,
        'GET',
        undefined,
        options,
      )
    },
    /** 创建项目环境变量或密钥引用。 */
    async createEnvVariable(
      projectId: string,
      environment: string,
      body: ApiBody<'/api/v1/projects/{projectId}/environments/{environment}/variables', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/projects/{projectId}/environments/{environment}/variables', 'post'>>(
        `/api/v1/projects/${segment(projectId)}/environments/${segment(environment)}/variables`,
        'POST',
        body,
        options,
      )
    },
    /** 更新项目环境变量。 */
    async updateEnvVariable(
      variableId: string,
      body: ApiBody<'/api/v1/project-variables/{variableId}/update', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/project-variables/{variableId}/update', 'post'>>(
        `/api/v1/project-variables/${segment(variableId)}/update`,
        'POST',
        body,
        options,
      )
    },
    /** 删除项目环境变量。 */
    async removeEnvVariable(
      variableId: string,
      body: ApiBody<'/api/v1/project-variables/{variableId}/remove', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/project-variables/{variableId}/remove', 'post'>>(
        `/api/v1/project-variables/${segment(variableId)}/remove`,
        'POST',
        body,
        options,
      )
    },

    /** 读取仓库提交列表。 */
    async listCommits(
      projectId: string,
      repositoryId: string,
      query?: ApiQuery<'/api/v1/projects/{projectId}/repositories/{repositoryId}/commits', 'get'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/projects/{projectId}/repositories/{repositoryId}/commits', 'get'>>(
        `/api/v1/projects/${segment(projectId)}/repositories/${segment(repositoryId)}/commits`,
        'GET',
        undefined,
        { ...options, query },
      )
    },
    /** 读取提交详情。 */
    async getCommit(projectId: string, repositoryId: string, ref: string, options: ApiCallOptions = {}) {
      return callTyped<ApiSuccessData<'/api/v1/projects/{projectId}/repositories/{repositoryId}/commits/{ref}', 'get'>>(
        `/api/v1/projects/${segment(projectId)}/repositories/${segment(repositoryId)}/commits/${segment(ref)}`,
        'GET',
        undefined,
        options,
      )
    },
    /** 读取仓库 PR 列表。 */
    async listPullRequests(
      projectId: string,
      repositoryId: string,
      query?: ApiQuery<'/api/v1/projects/{projectId}/repositories/{repositoryId}/pull-requests', 'get'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/projects/{projectId}/repositories/{repositoryId}/pull-requests', 'get'>>(
        `/api/v1/projects/${segment(projectId)}/repositories/${segment(repositoryId)}/pull-requests`,
        'GET',
        undefined,
        { ...options, query },
      )
    },
    /** 读取 PR 详情。 */
    async getPullRequest(projectId: string, repositoryId: string, number: string, options: ApiCallOptions = {}) {
      return callTyped<
        ApiSuccessData<'/api/v1/projects/{projectId}/repositories/{repositoryId}/pull-requests/{number}', 'get'>
      >(
        `/api/v1/projects/${segment(projectId)}/repositories/${segment(repositoryId)}/pull-requests/${segment(number)}`,
        'GET',
        undefined,
        options,
      )
    },
    /** 读取 PR 差异文本。 */
    async getPullRequestDiff(projectId: string, repositoryId: string, number: string, options: ApiCallOptions = {}) {
      return callTyped<
        ApiSuccessData<'/api/v1/projects/{projectId}/repositories/{repositoryId}/pull-requests/{number}/diff', 'get'>
      >(
        `/api/v1/projects/${segment(projectId)}/repositories/${segment(repositoryId)}/pull-requests/${segment(number)}/diff`,
        'GET',
        undefined,
        options,
      )
    },
    /** 读取团队技能列表。 */
    async listSkills(
      teamId: string,
      query?: ApiQuery<'/api/v1/teams/{teamId}/skills', 'get'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/teams/{teamId}/skills', 'get'>>(
        `/api/v1/teams/${segment(teamId)}/skills`,
        'GET',
        undefined,
        { ...options, query },
      )
    },
    /** 发布团队技能。 */
    async createSkill(
      teamId: string,
      body: ApiBody<'/api/v1/teams/{teamId}/skills', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/teams/{teamId}/skills', 'post'>>(
        `/api/v1/teams/${segment(teamId)}/skills`,
        'POST',
        body,
        options,
      )
    },
    /** 读取技能详情。 */
    async getSkill(skillId: string, options: ApiCallOptions = {}) {
      return callTyped<ApiSuccessData<'/api/v1/skills/{skillId}', 'get'>>(
        `/api/v1/skills/${segment(skillId)}`,
        'GET',
        undefined,
        options,
      )
    },
    /** 编辑技能。 */
    async updateSkill(
      skillId: string,
      body: ApiBody<'/api/v1/skills/{skillId}/update', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/skills/{skillId}/update', 'post'>>(
        `/api/v1/skills/${segment(skillId)}/update`,
        'POST',
        body,
        options,
      )
    },
    /** 启用技能。 */
    async enableSkill(
      skillId: string,
      body: ApiBody<'/api/v1/skills/{skillId}/enable', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/skills/{skillId}/enable', 'post'>>(
        `/api/v1/skills/${segment(skillId)}/enable`,
        'POST',
        body,
        options,
      )
    },
    /** 停用技能。 */
    async disableSkill(
      skillId: string,
      body: ApiBody<'/api/v1/skills/{skillId}/disable', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/skills/{skillId}/disable', 'post'>>(
        `/api/v1/skills/${segment(skillId)}/disable`,
        'POST',
        body,
        options,
      )
    },
    /** 读取技能版本历史。 */
    async listSkillVersions(
      skillId: string,
      query?: ApiQuery<'/api/v1/skills/{skillId}/versions', 'get'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/skills/{skillId}/versions', 'get'>>(
        `/api/v1/skills/${segment(skillId)}/versions`,
        'GET',
        undefined,
        { ...options, query },
      )
    },
    /** 读取技能历史版本正文。 */
    async getSkillVersion(skillId: string, skillVersionId: string, options: ApiCallOptions = {}) {
      return callTyped<ApiSuccessData<'/api/v1/skills/{skillId}/versions/{skillVersionId}', 'get'>>(
        `/api/v1/skills/${segment(skillId)}/versions/${segment(skillVersionId)}`,
        'GET',
        undefined,
        options,
      )
    },
    /** 读取技能活动。 */
    async listSkillActivities(
      skillId: string,
      query?: ApiQuery<'/api/v1/skills/{skillId}/activities', 'get'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/skills/{skillId}/activities', 'get'>>(
        `/api/v1/skills/${segment(skillId)}/activities`,
        'GET',
        undefined,
        { ...options, query },
      )
    },
    /** 读取团队 AGENTS.md 模板列表。 */
    async listAgentTemplates(
      teamId: string,
      query?: ApiQuery<'/api/v1/teams/{teamId}/agent-templates', 'get'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/teams/{teamId}/agent-templates', 'get'>>(
        `/api/v1/teams/${segment(teamId)}/agent-templates`,
        'GET',
        undefined,
        { ...options, query },
      )
    },
    /** 新建 AGENTS.md 模板。 */
    async createAgentTemplate(
      teamId: string,
      body: ApiBody<'/api/v1/teams/{teamId}/agent-templates', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/teams/{teamId}/agent-templates', 'post'>>(
        `/api/v1/teams/${segment(teamId)}/agent-templates`,
        'POST',
        body,
        options,
      )
    },
    /** 读取模板详情。 */
    async getAgentTemplate(templateId: string, options: ApiCallOptions = {}) {
      return callTyped<ApiSuccessData<'/api/v1/agent-templates/{templateId}', 'get'>>(
        `/api/v1/agent-templates/${segment(templateId)}`,
        'GET',
        undefined,
        options,
      )
    },
    /** 编辑模板。 */
    async updateAgentTemplate(
      templateId: string,
      body: ApiBody<'/api/v1/agent-templates/{templateId}/update', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/agent-templates/{templateId}/update', 'post'>>(
        `/api/v1/agent-templates/${segment(templateId)}/update`,
        'POST',
        body,
        options,
      )
    },
    /** 创建模板副本。 */
    async duplicateAgentTemplate(
      templateId: string,
      body: ApiBody<'/api/v1/agent-templates/{templateId}/duplicate', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/agent-templates/{templateId}/duplicate', 'post'>>(
        `/api/v1/agent-templates/${segment(templateId)}/duplicate`,
        'POST',
        body,
        options,
      )
    },
    /** 读取模板版本历史。 */
    async listAgentTemplateVersions(
      templateId: string,
      query?: ApiQuery<'/api/v1/agent-templates/{templateId}/versions', 'get'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/agent-templates/{templateId}/versions', 'get'>>(
        `/api/v1/agent-templates/${segment(templateId)}/versions`,
        'GET',
        undefined,
        { ...options, query },
      )
    },
    /** 读取模板历史版本正文。 */
    async getAgentTemplateVersion(templateId: string, templateVersionId: string, options: ApiCallOptions = {}) {
      return callTyped<ApiSuccessData<'/api/v1/agent-templates/{templateId}/versions/{templateVersionId}', 'get'>>(
        `/api/v1/agent-templates/${segment(templateId)}/versions/${segment(templateVersionId)}`,
        'GET',
        undefined,
        options,
      )
    },
    /** 读取模板活动。 */
    async listAgentTemplateActivities(
      templateId: string,
      query?: ApiQuery<'/api/v1/agent-templates/{templateId}/activities', 'get'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/agent-templates/{templateId}/activities', 'get'>>(
        `/api/v1/agent-templates/${segment(templateId)}/activities`,
        'GET',
        undefined,
        { ...options, query },
      )
    },
    /** 生成模板快照预览链接。 */
    async createTemplateSnapshotLink(templateId: string, options: ApiCallOptions = {}) {
      return callTyped<ApiSuccessData<'/api/v1/agent-templates/{templateId}/snapshot-links', 'post'>>(
        `/api/v1/agent-templates/${segment(templateId)}/snapshot-links`,
        'POST',
        undefined,
        options,
      )
    },
    /** 打开模板快照链接。 */
    async getTemplateSnapshot(token: string, options: ApiCallOptions = {}) {
      return callTyped<ApiSuccessData<'/api/v1/template-snapshot-links/{token}', 'get'>>(
        `/api/v1/template-snapshot-links/${segment(token)}`,
        'GET',
        undefined,
        options,
      )
    },
    /** 读取项目当前选用的模板。 */
    async getProjectAgentTemplate(projectId: string, options: ApiCallOptions = {}) {
      return callTyped<ApiSuccessData<'/api/v1/projects/{projectId}/agent-template', 'get'>>(
        `/api/v1/projects/${segment(projectId)}/agent-template`,
        'GET',
        undefined,
        options,
      )
    },
    /** 选用或切换项目模板。 */
    async applyProjectAgentTemplate(
      projectId: string,
      body: ApiBody<'/api/v1/projects/{projectId}/agent-template/apply', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/projects/{projectId}/agent-template/apply', 'post'>>(
        `/api/v1/projects/${segment(projectId)}/agent-template/apply`,
        'POST',
        body,
        options,
      )
    },
    /** 取消项目模板选用。 */
    async clearProjectAgentTemplate(
      projectId: string,
      body: ApiBody<'/api/v1/projects/{projectId}/agent-template/clear', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/projects/{projectId}/agent-template/clear', 'post'>>(
        `/api/v1/projects/${segment(projectId)}/agent-template/clear`,
        'POST',
        body,
        options,
      )
    },

    /** 读取项目在指定 ref 下的流水线工作流列表（含解析结果与最近运行）。 */
    async listPipelineWorkflows(
      projectId: string,
      query?: ApiQuery<'/api/v1/projects/{projectId}/pipeline-workflows', 'get'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/projects/{projectId}/pipeline-workflows', 'get'>>(
        `/api/v1/projects/${segment(projectId)}/pipeline-workflows`,
        'GET',
        undefined,
        { ...options, query },
      )
    },
    /** 读取单个工作流详情：原始 YAML、解析错误与运行计划摘要。 */
    async getPipelineWorkflow(
      projectId: string,
      query: ApiQuery<'/api/v1/projects/{projectId}/pipeline-workflows/detail', 'get'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/projects/{projectId}/pipeline-workflows/detail', 'get'>>(
        `/api/v1/projects/${segment(projectId)}/pipeline-workflows/detail`,
        'GET',
        undefined,
        { ...options, query },
      )
    },
    /** 手动触发一次流水线运行；同一幂等键返回同一次运行。 */
    async triggerPipelineRun(
      projectId: string,
      body: ApiBody<'/api/v1/projects/{projectId}/pipeline-runs', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/projects/{projectId}/pipeline-runs', 'post'>>(
        `/api/v1/projects/${segment(projectId)}/pipeline-runs`,
        'POST',
        body,
        options,
      )
    },
    /** 请求取消流水线运行；取消是尽力而为，返回最新运行详情。 */
    async cancelPipelineRun(
      runId: string,
      body: ApiBody<'/api/v1/pipeline-runs/{runId}/cancel', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/pipeline-runs/{runId}/cancel', 'post'>>(
        `/api/v1/pipeline-runs/${segment(runId)}/cancel`,
        'POST',
        body,
        options,
      )
    },
    /** 按步骤与 afterSeq 读取运行日志分片；运行中用于轮询增量。 */
    async listPipelineRunLogs(
      runId: string,
      query?: ApiQuery<'/api/v1/pipeline-runs/{runId}/logs', 'get'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/pipeline-runs/{runId}/logs', 'get'>>(
        `/api/v1/pipeline-runs/${segment(runId)}/logs`,
        'GET',
        undefined,
        { ...options, query },
      )
    },
    /** 读取运行产物元数据；下载地址由服务端按权限签发。 */
    async listPipelineArtifacts(runId: string, options: ApiCallOptions = {}) {
      return callTyped<ApiSuccessData<'/api/v1/pipeline-runs/{runId}/artifacts', 'get'>>(
        `/api/v1/pipeline-runs/${segment(runId)}/artifacts`,
        'GET',
        undefined,
        options,
      )
    },
    /** 读取团队执行节点列表；仅团队管理员可见完整字段。 */
    async listPipelineNodes(teamId: string, options: ApiCallOptions = {}) {
      return callTyped<ApiSuccessData<'/api/v1/teams/{teamId}/pipeline-nodes', 'get'>>(
        `/api/v1/teams/${segment(teamId)}/pipeline-nodes`,
        'GET',
        undefined,
        options,
      )
    },
    /** 注册执行节点并返回一次性注册令牌。 */
    async createPipelineNode(
      teamId: string,
      body: ApiBody<'/api/v1/teams/{teamId}/pipeline-nodes', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/teams/{teamId}/pipeline-nodes', 'post'>>(
        `/api/v1/teams/${segment(teamId)}/pipeline-nodes`,
        'POST',
        body,
        options,
      )
    },
    /** 排空执行节点：不再分配新运行，已有任务继续。 */
    async drainPipelineNode(nodeId: string, options: ApiCallOptions = {}) {
      return callTyped<ApiSuccessData<'/api/v1/pipeline-nodes/{nodeId}/drain', 'post'>>(
        `/api/v1/pipeline-nodes/${segment(nodeId)}/drain`,
        'POST',
        undefined,
        options,
      )
    },
    /** 停用执行节点并撤销活动 Agent 令牌。 */
    async disablePipelineNode(nodeId: string, options: ApiCallOptions = {}) {
      return callTyped<ApiSuccessData<'/api/v1/pipeline-nodes/{nodeId}/disable', 'post'>>(
        `/api/v1/pipeline-nodes/${segment(nodeId)}/disable`,
        'POST',
        undefined,
        options,
      )
    },
    /** 轮换节点 Agent 令牌并返回新令牌（只显示一次）。 */
    async rotatePipelineNodeToken(nodeId: string, options: ApiCallOptions = {}) {
      return callTyped<ApiSuccessData<'/api/v1/pipeline-nodes/{nodeId}/tokens/rotate', 'post'>>(
        `/api/v1/pipeline-nodes/${segment(nodeId)}/tokens/rotate`,
        'POST',
        undefined,
        options,
      )
    },
    /** 读取平台储存桶列表；服务端已按内置桶、默认桶、创建时间倒序稳定排序。 */
    async listStorageBuckets(options: ApiCallOptions = {}) {
      return callTyped<ApiSuccessData<'/api/v1/platform/storage-buckets', 'get'>>(
        '/api/v1/platform/storage-buckets',
        'GET',
        undefined,
        options,
      )
    },
    /** 创建 S3 兼容储存桶；setAsDefault=true 时由服务端先完成可读写探测。 */
    async createStorageBucket(body: ApiBody<'/api/v1/platform/storage-buckets', 'post'>, options: ApiCallOptions = {}) {
      return callTyped<ApiSuccessData<'/api/v1/platform/storage-buckets', 'post'>>(
        '/api/v1/platform/storage-buckets',
        'POST',
        body,
        options,
      )
    },
    /** 更新储存桶配置；version 用于乐观锁，Secret 省略表示保持原值。 */
    async updateStorageBucket(
      bucketId: string,
      body: ApiBody<'/api/v1/platform/storage-buckets/{bucketId}/update', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/platform/storage-buckets/{bucketId}/update', 'post'>>(
        `/api/v1/platform/storage-buckets/${segment(bucketId)}/update`,
        'POST',
        body,
        options,
      )
    },
    /** 测试储存桶连接；服务端返回写探针、读回与删除探针的归因结论。 */
    async testStorageBucket(bucketId: string, options: ApiCallOptions = {}) {
      return callTyped<ApiSuccessData<'/api/v1/platform/storage-buckets/{bucketId}/test', 'post'>>(
        `/api/v1/platform/storage-buckets/${segment(bucketId)}/test`,
        'POST',
        undefined,
        options,
      )
    },
    /** 设为默认储存桶；服务端要求桶已启用且最近探测为 read_write。 */
    async setStorageBucketDefault(
      bucketId: string,
      body: ApiBody<'/api/v1/platform/storage-buckets/{bucketId}/set-default', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/platform/storage-buckets/{bucketId}/set-default', 'post'>>(
        `/api/v1/platform/storage-buckets/${segment(bucketId)}/set-default`,
        'POST',
        body,
        options,
      )
    },
    /** 删除储存桶；内置桶、默认桶与仍被附件引用的桶由服务端拒绝。 */
    async removeStorageBucket(bucketId: string, options: ApiCallOptions = {}) {
      return callTyped<ApiSuccessData<'/api/v1/platform/storage-buckets/{bucketId}/remove', 'post'>>(
        `/api/v1/platform/storage-buckets/${segment(bucketId)}/remove`,
        'POST',
        undefined,
        options,
      )
    },
  }
}
