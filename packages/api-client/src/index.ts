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
  /** 单次请求超时覆盖，仅用于可预期的慢读取；不传时使用客户端默认值。 */
  timeoutMs?: number
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

/** 可以安全展示给用户的业务错误码；数据库或内部错误不向调用方透传正文。 */
const PUBLIC_BUSINESS_CODES = new Set([
  'VALIDATION_ERROR',
  'PRECONDITION_FAILED',
  'DUPLICATE_RELATION',
  'INVALID_TRANSITION',
  'VERSION_CONFLICT',
  'CODE_CHANGE_NOT_FOUND',
  'PIPELINE_SECRET_UNAVAILABLE',
])

function createBusinessError(body: ApiFailureEnvelope, requestId: string): RequestError {
  const safeMessage = PUBLIC_BUSINESS_CODES.has(body.code) ? body.message.trim() : ''
  return new RequestError(safeMessage || '操作未完成，请稍后重试。', {
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

  async function fetchResponse(
    path: string,
    init: Omit<RequestInit, 'headers'> & { headers: Record<string, string> },
    signal?: AbortSignal,
    timeoutOverrideMs?: number,
  ): Promise<{ response: Response; timeout: AbortSignal }> {
    const url = new URL(baseUrl)
    const [pathname, queryString] = path.split('?')
    url.pathname = `${url.pathname.replace(/\/+$/, '')}${pathname ?? ''}`
    url.search = queryString ?? ''
    const timeout = AbortSignal.timeout(timeoutOverrideMs ?? timeoutMs)
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout
    const headers = {
      ...init.headers,
      ...(options.token === undefined ? {} : { authorization: `Bearer ${options.token}` }),
    }
    try {
      const response = await (fetchRequest ?? globalThis.fetch)(url, {
        ...init,
        headers,
        signal: requestSignal,
        redirect: 'error',
        credentials: options.credentials ?? 'omit',
      })
      return { response, timeout }
    } catch (error) {
      if (signal?.aborted) throw error
      throw new RequestError(timeout.aborted ? '请求超时，请稍后重试。' : '无法连接后端，请检查服务地址和网络。', {
        code: timeout.aborted ? 'TIMEOUT' : 'NETWORK_ERROR',
      })
    }
  }

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
    timeoutOverrideMs?: number,
  ) {
    const { response, timeout } = await fetchResponse(
      path,
      {
        method,
        headers: {
          accept: 'application/json',
          ...(idempotencyKey === undefined ? {} : { 'idempotency-key': idempotencyKey }),
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
      signal,
      timeoutOverrideMs,
    )
    return readJsonResponse(response, timeout, signal)
  }

  async function readJsonResponse(response: Response, timeout: AbortSignal, signal?: AbortSignal) {
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
      options.timeoutMs,
    )
    return checkedEnvelope<T>(method, path, payload, headerRequestId)
  }

  function checkedEnvelope<T>(
    method: 'GET' | 'POST',
    path: string,
    payload: unknown,
    headerRequestId: string | null,
  ): { data: T; requestId: string } {
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

  async function downloadFile(path: string, call: ApiCallOptions) {
    const { response, timeout } = await fetchResponse(
      path,
      { method: 'GET', headers: { accept: 'application/octet-stream, application/json' } },
      call.signal,
      call.timeoutMs,
    )
    const contentType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()
    const requestId = response.headers.get('x-request-id') ?? ''
    const sha256 = response.headers.get('x-content-sha256')
    if (
      response.ok &&
      contentType === 'application/octet-stream' &&
      response.body &&
      sha256 &&
      /^[0-9a-f]{64}$/i.test(sha256)
    ) {
      return { body: response.body, sha256: sha256.toLowerCase(), requestId, timeout }
    }
    if (contentType === 'application/json') {
      const envelope = await readJsonResponse(response, timeout, call.signal)
      if (isFailureEnvelope(envelope.payload)) {
        throw createBusinessError(envelope.payload, envelope.headerRequestId ?? envelope.payload.requestId)
      }
    } else {
      await response.body?.cancel()
    }
    throw new RequestError('下载响应缺少有效的文件或校验值。', {
      code: response.ok ? 'INVALID_RESPONSE' : 'HTTP_ERROR',
      status: response.status,
      requestId,
    })
  }

  return {
    /**
     * 读取项目附件大小和绑定数量限制。
     * @param call 请求选项。
     * @returns 已校验的附件策略和请求标识。
     */
    async getAttachmentPolicy(call: ApiCallOptions = {}) {
      return callTyped<ApiSuccessData<'/api/v1/attachments/policy', 'get'>>(
        '/api/v1/attachments/policy',
        'GET',
        undefined,
        call,
      )
    },

    /**
     * 上传待绑定附件；通过 Blob 发送文件并由服务端检验大小与权限。
     * @param projectId 目标项目。
     * @param file 本地文件 Blob。
     * @param metadata 文件名称及媒体类型。
     * @param call 请求选项。
     * @returns 已校验的临时附件记录和请求标识；上传失败抛出 RequestError。
     */
    async uploadAttachment(
      projectId: string,
      file: Blob,
      metadata: { name: string; contentType: string },
      call: ApiCallOptions = {},
    ) {
      const path = `/api/v1/projects/${segment(projectId)}/attachments`
      const { response, timeout } = await fetchResponse(
        path,
        {
          method: 'POST',
          headers: {
            accept: 'application/json',
            'content-type': 'application/octet-stream',
            'x-file-name': encodeURIComponent(metadata.name),
            'x-file-type': metadata.contentType,
          },
          body: file,
        },
        call.signal,
        call.timeoutMs,
      )
      const { payload, headerRequestId } = await readJsonResponse(response, timeout, call.signal)
      return checkedEnvelope<ApiSuccessData<'/api/v1/projects/{projectId}/attachments', 'post'>>(
        'POST',
        path,
        payload,
        headerRequestId,
      )
    },

    /**
     * 删除指定附件。
     * @param attachmentId 附件标识。
     * @param call 请求选项。
     * @returns 删除结果和请求标识；服务端拒绝时抛出 RequestError。
     */
    async removeAttachment(attachmentId: string, call: ApiCallOptions = {}) {
      return callTyped<ApiSuccessData<'/api/v1/attachments/{attachmentId}/remove', 'post'>>(
        `/api/v1/attachments/${segment(attachmentId)}/remove`,
        'POST',
        undefined,
        call,
      )
    },

    /**
     * 打开附件下载流。
     * @param attachmentId 附件标识。
     * @param call 请求选项。
     * @returns 文件流与 SHA-256；调用者负责消费或取消响应流并核对摘要。
     */
    async downloadAttachment(attachmentId: string, call: ApiCallOptions = {}) {
      return downloadFile(`/api/v1/attachments/${segment(attachmentId)}/download`, call)
    },

    /**
     * 打开流水线产物下载流。
     * @param artifactId 产物标识。
     * @param call 请求选项。
     * @returns 文件流与 SHA-256；调用者负责消费或取消响应流并核对摘要。
     */
    async downloadPipelineArtifact(artifactId: string, call: ApiCallOptions = {}) {
      return downloadFile(`/api/v1/pipeline-artifacts/${segment(artifactId)}/download`, call)
    },

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
    /** 读取浏览器当前用户的 GitHub 绑定状态，不返回授权凭据。 */
    async getGitHubAccount(options: ApiCallOptions = {}) {
      return callTyped<ApiSuccessData<'/api/v1/me/github-account', 'get'>>(
        '/api/v1/me/github-account',
        'GET',
        undefined,
        options,
      )
    },
    /** 发起当前账号的 GitHub 授权，成功后返回浏览器应打开的授权地址。 */
    async authorizeGitHubAccount(
      body: ApiBody<'/api/v1/me/github-account/authorize', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/me/github-account/authorize', 'post'>>(
        '/api/v1/me/github-account/authorize',
        'POST',
        body,
        options,
      )
    },
    /**
     * 检查项目成员的个人 GitHub 权限后取得写操作地址。
     * @param projectId 项目标识。
     * @param repositoryId 项目已关联的 GitHub 仓库。
     * @param body 创建 PR 或编辑分支文件的操作。
     * @param options 请求取消等调用选项。
     * @returns GitHub 地址；未绑定、权限不足或连接失效时抛出业务错误。
     */
    async openGitHubRepositoryAction(
      projectId: string,
      repositoryId: string,
      body: ApiBody<'/api/v1/projects/{projectId}/repositories/{repositoryId}/github-action', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<
        ApiSuccessData<'/api/v1/projects/{projectId}/repositories/{repositoryId}/github-action', 'post'>
      >(
        `/api/v1/projects/${segment(projectId)}/repositories/${segment(repositoryId)}/github-action`,
        'POST',
        body,
        options,
      )
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
    /**
     * 分页读取团队项目已关联的仓库选项。
     * @param teamId 团队标识。
     * @param query 页码与每页数量。
     * @param options 请求取消与其他调用选项。
     * @returns 当前页仓库选项和总数。
     */
    async listProjectRepositoryOptions(
      teamId: string,
      query?: ApiQuery<'/api/v1/teams/{teamId}/project-repositories', 'get'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/teams/{teamId}/project-repositories', 'get'>>(
        `/api/v1/teams/${segment(teamId)}/project-repositories`,
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
    /**
     * 分页读取团队回收站。
     * @param teamId 团队标识。
     * @param query 分页参数。
     * @param options 请求取消等调用选项。
     * @returns 结果信封；请求失败时抛出对应业务错误。
     */
    async listProjectRecycleBin(
      teamId: string,
      query?: ApiQuery<'/api/v1/teams/{teamId}/project-recycle-bin', 'get'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/teams/{teamId}/project-recycle-bin', 'get'>>(
        `/api/v1/teams/${segment(teamId)}/project-recycle-bin`,
        'GET',
        undefined,
        { ...options, query },
      )
    },
    /**
     * 验证密码后将项目移入回收站。
     * @param projectId 项目标识。
     * @param body 项目版本和当前账号密码。
     * @param options 请求取消等调用选项。
     * @returns 结果信封；请求失败时抛出对应业务错误。
     */
    async removeProject(
      projectId: string,
      body: ApiBody<'/api/v1/projects/{projectId}/remove', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/projects/{projectId}/remove', 'post'>>(
        `/api/v1/projects/${segment(projectId)}/remove`,
        'POST',
        body,
        options,
      )
    },
    /**
     * 将回收站中的项目恢复到正常列表。
     * @param projectId 项目标识。
     * @param body 项目版本。
     * @param options 请求取消等调用选项。
     * @returns 结果信封；请求失败时抛出对应业务错误。
     */
    async restoreProject(
      projectId: string,
      body: ApiBody<'/api/v1/projects/{projectId}/restore', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/projects/{projectId}/restore', 'post'>>(
        `/api/v1/projects/${segment(projectId)}/restore`,
        'POST',
        body,
        options,
      )
    },
    /**
     * 验证密码后提交或重试文件清理。
     * @param projectId 项目标识。
     * @param body 项目版本和当前账号密码。
     * @param options 请求取消等调用选项。
     * @returns 结果信封；请求失败时抛出对应业务错误。
     */
    async cleanupProjectFiles(
      projectId: string,
      body: ApiBody<'/api/v1/projects/{projectId}/cleanup-files', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/projects/{projectId}/cleanup-files', 'post'>>(
        `/api/v1/projects/${segment(projectId)}/cleanup-files`,
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
    /**
     * 查询当前团队管理员个人授权可访问的 GitHub App 安装。
     * @param teamId 当前团队标识。
     * @param options 调用选项，包括取消信号。
     * @returns 已有安装列表；权限不足或个人授权失效时请求失败。
     */
    async discoverGitHubInstallations(teamId: string, options: ApiCallOptions = {}) {
      return callTyped<ApiSuccessData<'/api/v1/teams/{teamId}/github-installations/discover', 'post'>>(
        `/api/v1/teams/${segment(teamId)}/github-installations/discover`,
        'POST',
        undefined,
        options,
      )
    },
    /**
     * 创建 Git 连接、绑定已有安装或获取 GitHub 授权地址。
     * @param teamId 当前团队标识。
     * @param body 提供方与连接参数，已有 GitHub 安装使用 installationId。
     * @param options 调用选项，包括取消信号。
     * @returns 保存的连接或新安装授权地址；权限不足或同步失败时请求失败。
     */
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
    /** 读取团队 Bot 列表。 */
    async listBots(
      teamId: string,
      query?: ApiQuery<'/api/v1/teams/{teamId}/bots', 'get'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/teams/{teamId}/bots', 'get'>>(
        `/api/v1/teams/${segment(teamId)}/bots`,
        'GET',
        undefined,
        { ...options, query },
      )
    },
    /** 创建团队 Bot。 */
    async createBot(
      teamId: string,
      body: ApiBody<'/api/v1/teams/{teamId}/bots', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/teams/{teamId}/bots', 'post'>>(
        `/api/v1/teams/${segment(teamId)}/bots`,
        'POST',
        body,
        options,
      )
    },
    /**
     * 设置 Bot 的本地工具访问范围。
     * @param id Bot 标识。
     * @param body 配置版本与沙盒或完全访问模式。
     * @param options 幂等键与请求选项。
     * @returns 更新后的配置；权限和版本错误通过统一信封抛出。
     */
    async setBotAccess(
      id: string,
      body: ApiBody<'/api/v1/bots/{botId}/set-access', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/bots/{botId}/set-access', 'post'>>(
        `/api/v1/bots/${segment(id)}/set-access`,
        'POST',
        body,
        options,
      )
    },
    /** 读取 Bot 配置。 */
    async getBot(id: string, options: ApiCallOptions = {}) {
      return callTyped<ApiSuccessData<'/api/v1/bots/{botId}', 'get'>>(
        `/api/v1/bots/${segment(id)}`,
        'GET',
        undefined,
        options,
      )
    },
    /** 更新 Bot 常规配置。 */
    async updateBot(id: string, body: ApiBody<'/api/v1/bots/{botId}/update', 'post'>, options: ApiCallOptions = {}) {
      return callTyped<ApiSuccessData<'/api/v1/bots/{botId}/update', 'post'>>(
        `/api/v1/bots/${segment(id)}/update`,
        'POST',
        body,
        options,
      )
    },
    /** 启用或停用 Bot。停用动作同时请求结束该 Bot 的在途运行。 */
    async setBotEnabled(
      id: string,
      enabled: boolean,
      body: ApiBody<'/api/v1/bots/{botId}/enable', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/bots/{botId}/enable', 'post'>>(
        `/api/v1/bots/${segment(id)}/${enabled ? 'enable' : 'disable'}`,
        'POST',
        body,
        options,
      )
    },
    /** 以管理员身份为 Bot 绑定模型。 */
    async bindBotModel(
      id: string,
      body: ApiBody<'/api/v1/bots/{botId}/bind-model', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/bots/{botId}/bind-model', 'post'>>(
        `/api/v1/bots/${segment(id)}/bind-model`,
        'POST',
        body,
        options,
      )
    },
    /** 获取当前成员能看到的 Bot 运行记录。 */
    async listBotRuns(id: string, query?: ApiQuery<'/api/v1/bots/{botId}/runs', 'get'>, options: ApiCallOptions = {}) {
      return callTyped<ApiSuccessData<'/api/v1/bots/{botId}/runs', 'get'>>(
        `/api/v1/bots/${segment(id)}/runs`,
        'GET',
        undefined,
        { ...options, query },
      )
    },
    /** 读取团队模型连接。 */
    async listBotConnections(teamId: string, options: ApiCallOptions = {}) {
      return callTyped<ApiSuccessData<'/api/v1/teams/{teamId}/bot-model-connections', 'get'>>(
        `/api/v1/teams/${segment(teamId)}/bot-model-connections`,
        'GET',
        undefined,
        options,
      )
    },
    /** 读取团队可选模型。 */
    async listBotModelCatalog(
      teamId: string,
      query?: ApiQuery<'/api/v1/teams/{teamId}/bot-model-catalog', 'get'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/teams/{teamId}/bot-model-catalog', 'get'>>(
        `/api/v1/teams/${segment(teamId)}/bot-model-catalog`,
        'GET',
        undefined,
        { ...options, query },
      )
    },
    /** 创建团队 API Key 连接。 */
    async createBotConnection(
      teamId: string,
      body: ApiBody<'/api/v1/teams/{teamId}/bot-model-connections', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/teams/{teamId}/bot-model-connections', 'post'>>(
        `/api/v1/teams/${segment(teamId)}/bot-model-connections`,
        'POST',
        body,
        options,
      )
    },
    /** 发起订阅登录。 */
    async startBotOAuthLogin(
      teamId: string,
      body: ApiBody<'/api/v1/teams/{teamId}/bot-model-connections/oauth-login', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/teams/{teamId}/bot-model-connections/oauth-login', 'post'>>(
        `/api/v1/teams/${segment(teamId)}/bot-model-connections/oauth-login`,
        'POST',
        body,
        options,
      )
    },
    /** 读取订阅授权状态。 */
    async getBotOAuthLogin(sessionId: string, options: ApiCallOptions = {}) {
      return callTyped<ApiSuccessData<'/api/v1/bot-model-login-sessions/{sessionId}', 'get'>>(
        `/api/v1/bot-model-login-sessions/${segment(sessionId)}`,
        'GET',
        undefined,
        options,
      )
    },
    /** 提交订阅授权输入。 */
    async answerBotOAuthLogin(
      sessionId: string,
      body: ApiBody<'/api/v1/bot-model-login-sessions/{sessionId}/answer', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/bot-model-login-sessions/{sessionId}/answer', 'post'>>(
        `/api/v1/bot-model-login-sessions/${segment(sessionId)}/answer`,
        'POST',
        body,
        options,
      )
    },
    /** 取消订阅授权。 */
    async cancelBotOAuthLogin(sessionId: string, options: ApiCallOptions = {}) {
      return callTyped<ApiSuccessData<'/api/v1/bot-model-login-sessions/{sessionId}/cancel', 'post'>>(
        `/api/v1/bot-model-login-sessions/${segment(sessionId)}/cancel`,
        'POST',
        undefined,
        options,
      )
    },
    /** 修改模型连接的启用状态。 */
    async setBotConnectionEnabled(
      connectionId: string,
      enabled: boolean,
      body: ApiBody<'/api/v1/bot-model-connections/{connectionId}/enable', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/bot-model-connections/{connectionId}/enable', 'post'>>(
        `/api/v1/bot-model-connections/${segment(connectionId)}/${enabled ? 'enable' : 'disable'}`,
        'POST',
        body,
        options,
      )
    },
    /** 读取当前用户可见的团队 Bot 会话。 */
    async listBotConversations(
      teamId: string,
      query?: ApiQuery<'/api/v1/teams/{teamId}/bot-conversations', 'get'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/teams/{teamId}/bot-conversations', 'get'>>(
        `/api/v1/teams/${segment(teamId)}/bot-conversations`,
        'GET',
        undefined,
        { ...options, query },
      )
    },
    /**
     * 保存或取消当前成员对 Bot 回复的评价。
     * @param conversationId 来源会话。
     * @param messageId Bot 回复标识。
     * @param body 好评、差评或取消选择。
     * @param options 幂等键与请求选项。
     * @returns 保存后的选择；不可见或只读会话抛出业务错误。
     */
    async rateBotMessage(
      conversationId: string,
      messageId: string,
      body: ApiBody<'/api/v1/bot-conversations/{conversationId}/messages/{messageId}/feedback', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<
        ApiSuccessData<'/api/v1/bot-conversations/{conversationId}/messages/{messageId}/feedback', 'post'>
      >(
        `/api/v1/bot-conversations/${segment(conversationId)}/messages/${segment(messageId)}/feedback`,
        'POST',
        body,
        options,
      )
    },
    /** 创建 Bot 群组或打开现有私聊。 */
    async createBotConversation(
      teamId: string,
      body: ApiBody<'/api/v1/teams/{teamId}/bot-conversations', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/teams/{teamId}/bot-conversations', 'post'>>(
        `/api/v1/teams/${segment(teamId)}/bot-conversations`,
        'POST',
        body,
        options,
      )
    },
    /** 更新群组名称、Leader、职责和指令。 */
    async updateBotConversation(
      conversationId: string,
      body: ApiBody<'/api/v1/bot-conversations/{conversationId}/update', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/bot-conversations/{conversationId}/update', 'post'>>(
        `/api/v1/bot-conversations/${segment(conversationId)}/update`,
        'POST',
        body,
        options,
      )
    },
    /** 添加或移出一位群组成员，返回更新后的会话。 */
    async updateBotConversationMember(
      conversationId: string,
      action: 'add' | 'remove',
      body: ApiBody<'/api/v1/bot-conversations/{conversationId}/members/add', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/bot-conversations/{conversationId}/members/add', 'post'>>(
        `/api/v1/bot-conversations/${segment(conversationId)}/members/${action}`,
        'POST',
        body,
        options,
      )
    },
    /** 读取会话及可见成员。 */
    async getBotConversation(conversationId: string, options: ApiCallOptions = {}) {
      return callTyped<ApiSuccessData<'/api/v1/bot-conversations/{conversationId}', 'get'>>(
        `/api/v1/bot-conversations/${segment(conversationId)}`,
        'GET',
        undefined,
        options,
      )
    },
    /** 按消息序号读取历史。 */
    async listBotMessages(
      conversationId: string,
      query?: ApiQuery<'/api/v1/bot-conversations/{conversationId}/messages', 'get'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/bot-conversations/{conversationId}/messages', 'get'>>(
        `/api/v1/bot-conversations/${segment(conversationId)}/messages`,
        'GET',
        undefined,
        { ...options, query },
      )
    },
    /** 将一条消息写入会话并安排运行。 */
    async sendBotMessage(
      conversationId: string,
      body: ApiBody<'/api/v1/bot-conversations/{conversationId}/messages', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/bot-conversations/{conversationId}/messages', 'post'>>(
        `/api/v1/bot-conversations/${segment(conversationId)}/messages`,
        'POST',
        body,
        options,
      )
    },
    /** 增量读取会话事件与当前在途运行。 */
    async listBotConversationEvents(
      conversationId: string,
      query?: ApiQuery<'/api/v1/bot-conversations/{conversationId}/events', 'get'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/bot-conversations/{conversationId}/events', 'get'>>(
        `/api/v1/bot-conversations/${segment(conversationId)}/events`,
        'GET',
        undefined,
        { ...options, query },
      )
    },
    /**
     * 编辑并重发当前私聊消息。
     * @param conversationId 会话标识。
     * @param messageId 消息标识。
     * @param body 当前操作的请求数据。
     * @param options 取消信号和可选的幂等标识。
     * @returns 校验后的平台响应，业务失败时拒绝。
     */
    async editBotMessage(
      conversationId: string,
      messageId: string,
      body: ApiBody<'/api/v1/bot-conversations/{conversationId}/messages/{messageId}/edit-resend', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<
        ApiSuccessData<'/api/v1/bot-conversations/{conversationId}/messages/{messageId}/edit-resend', 'post'>
      >(
        `/api/v1/bot-conversations/${segment(conversationId)}/messages/${segment(messageId)}/edit-resend`,
        'POST',
        body,
        options,
      )
    },
    /**
     * 切换私聊的编辑分支。
     * @param conversationId 会话标识。
     * @param body 当前操作的请求数据。
     * @param options 取消信号和可选的幂等标识。
     * @returns 校验后的平台响应，业务失败时拒绝。
     */
    async switchBotConversationBranch(
      conversationId: string,
      body: ApiBody<'/api/v1/bot-conversations/{conversationId}/branches/switch', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/bot-conversations/{conversationId}/branches/switch', 'post'>>(
        `/api/v1/bot-conversations/${segment(conversationId)}/branches/switch`,
        'POST',
        body,
        options,
      )
    },
    /**
     * 从指定消息创建独立的会话。
     * @param conversationId 会话标识。
     * @param body 当前操作的请求数据。
     * @param options 取消信号和可选的幂等标识。
     * @returns 校验后的平台响应，业务失败时拒绝。
     */
    async forkBotConversation(
      conversationId: string,
      body: ApiBody<'/api/v1/bot-conversations/{conversationId}/fork', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/bot-conversations/{conversationId}/fork', 'post'>>(
        `/api/v1/bot-conversations/${segment(conversationId)}/fork`,
        'POST',
        body,
        options,
      )
    },
    /**
     * 设置当前会话内单个 Bot 的模型与思考等级。
     * @param conversationId 会话标识。
     * @param botId 智能体标识。
     * @param body 当前操作的请求数据。
     * @param options 取消信号和可选的幂等标识。
     * @returns 校验后的平台响应，业务失败时拒绝。
     */
    async updateBotSessionSettings(
      conversationId: string,
      botId: string,
      body: ApiBody<'/api/v1/bot-conversations/{conversationId}/bots/{botId}/settings', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/bot-conversations/{conversationId}/bots/{botId}/settings', 'post'>>(
        `/api/v1/bot-conversations/${segment(conversationId)}/bots/${segment(botId)}/settings`,
        'POST',
        body,
        options,
      )
    },
    /**
     * 为当前 Bot 会话排入主动压缩。
     * @param conversationId 会话标识。
     * @param botId 智能体标识。
     * @param options 取消信号和可选的幂等标识。
     * @returns 校验后的平台响应，业务失败时拒绝。
     */
    async compactBotConversation(conversationId: string, botId: string, options: ApiCallOptions = {}) {
      return callTyped<ApiSuccessData<'/api/v1/bot-conversations/{conversationId}/bots/{botId}/compact', 'post'>>(
        `/api/v1/bot-conversations/${segment(conversationId)}/bots/${segment(botId)}/compact`,
        'POST',
        undefined,
        options,
      )
    },
    /**
     * 重新播种已损坏的 Bot 会话树。
     * @param conversationId 会话标识。
     * @param botId 智能体标识。
     * @param options 取消信号和可选的幂等标识。
     * @returns 校验后的平台响应，业务失败时拒绝。
     */
    async reseedBotConversation(conversationId: string, botId: string, options: ApiCallOptions = {}) {
      return callTyped<ApiSuccessData<'/api/v1/bot-conversations/{conversationId}/bots/{botId}/reseed', 'post'>>(
        `/api/v1/bot-conversations/${segment(conversationId)}/bots/${segment(botId)}/reseed`,
        'POST',
        undefined,
        options,
      )
    },
    /**
     * 读取团队共享的 Bot 上下文。
     * @param teamId 团队标识。
     * @param options 取消信号和可选的幂等标识。
     * @returns 校验后的平台响应，业务失败时拒绝。
     */
    async getTeamBotContext(teamId: string, options: ApiCallOptions = {}) {
      return callTyped<ApiSuccessData<'/api/v1/teams/{teamId}/bot-context', 'get'>>(
        `/api/v1/teams/${segment(teamId)}/bot-context`,
        'GET',
        undefined,
        options,
      )
    },
    /**
     * 保存带版本检查的团队 Bot 上下文。
     * @param teamId 团队标识。
     * @param body 当前操作的请求数据。
     * @param options 取消信号和可选的幂等标识。
     * @returns 校验后的平台响应，业务失败时拒绝。
     */
    async updateTeamBotContext(
      teamId: string,
      body: ApiBody<'/api/v1/teams/{teamId}/bot-context', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/teams/{teamId}/bot-context', 'post'>>(
        `/api/v1/teams/${segment(teamId)}/bot-context`,
        'POST',
        body,
        options,
      )
    },
    /**
     * 列出团队提示模板，可按关键词或游标查询。
     * @param teamId 团队标识。
     * @param query 筛选与分页条件。
     * @param options 取消信号和可选的幂等标识。
     * @returns 校验后的平台响应，业务失败时拒绝。
     */
    async listBotPromptTemplates(
      teamId: string,
      query?: ApiQuery<'/api/v1/teams/{teamId}/bot-prompt-templates', 'get'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/teams/{teamId}/bot-prompt-templates', 'get'>>(
        `/api/v1/teams/${segment(teamId)}/bot-prompt-templates`,
        'GET',
        undefined,
        { ...options, query },
      )
    },
    /**
     * 创建团队提示模板。
     * @param teamId 团队标识。
     * @param body 当前操作的请求数据。
     * @param options 取消信号和可选的幂等标识。
     * @returns 校验后的平台响应，业务失败时拒绝。
     */
    async createBotPromptTemplate(
      teamId: string,
      body: ApiBody<'/api/v1/teams/{teamId}/bot-prompt-templates', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/teams/{teamId}/bot-prompt-templates', 'post'>>(
        `/api/v1/teams/${segment(teamId)}/bot-prompt-templates`,
        'POST',
        body,
        options,
      )
    },
    /**
     * 保存提示模板的修改。
     * @param templateId 提示模板标识。
     * @param body 当前操作的请求数据。
     * @param options 取消信号和可选的幂等标识。
     * @returns 校验后的平台响应，业务失败时拒绝。
     */
    async updateBotPromptTemplate(
      templateId: string,
      body: ApiBody<'/api/v1/bot-prompt-templates/{templateId}/update', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/bot-prompt-templates/{templateId}/update', 'post'>>(
        `/api/v1/bot-prompt-templates/${segment(templateId)}/update`,
        'POST',
        body,
        options,
      )
    },
    /**
     * 移除提示模板。
     * @param templateId 提示模板标识。
     * @param options 取消信号和可选的幂等标识。
     * @returns 校验后的平台响应，业务失败时拒绝。
     */
    async removeBotPromptTemplate(templateId: string, options: ApiCallOptions = {}) {
      return callTyped<ApiSuccessData<'/api/v1/bot-prompt-templates/{templateId}/remove', 'post'>>(
        `/api/v1/bot-prompt-templates/${segment(templateId)}/remove`,
        'POST',
        undefined,
        options,
      )
    },
    /**
     * 按成员权限读取团队的远程 MCP 服务。
     * @param teamId 团队标识。
     * @param query 筛选与分页条件。
     * @param options 取消信号和可选的幂等标识。
     * @returns 校验后的平台响应，业务失败时拒绝。
     */
    async listBotMcpServers(
      teamId: string,
      query?: ApiQuery<'/api/v1/teams/{teamId}/bot-mcp-servers', 'get'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/teams/{teamId}/bot-mcp-servers', 'get'>>(
        `/api/v1/teams/${segment(teamId)}/bot-mcp-servers`,
        'GET',
        undefined,
        { ...options, query },
      )
    },
    /**
     * 保存新远程 MCP 服务和授权。
     * @param teamId 团队标识。
     * @param body 当前操作的请求数据。
     * @param options 取消信号和可选的幂等标识。
     * @returns 校验后的平台响应，业务失败时拒绝。
     */
    async createBotMcpServer(
      teamId: string,
      body: ApiBody<'/api/v1/teams/{teamId}/bot-mcp-servers', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/teams/{teamId}/bot-mcp-servers', 'post'>>(
        `/api/v1/teams/${segment(teamId)}/bot-mcp-servers`,
        'POST',
        body,
        options,
      )
    },
    /**
     * 更新远程 MCP 服务和授权范围。
     * @param serverId 远程 MCP 服务标识。
     * @param body 当前操作的请求数据。
     * @param options 取消信号和可选的幂等标识。
     * @returns 校验后的平台响应，业务失败时拒绝。
     */
    async updateBotMcpServer(
      serverId: string,
      body: ApiBody<'/api/v1/bot-mcp-servers/{serverId}/update', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/bot-mcp-servers/{serverId}/update', 'post'>>(
        `/api/v1/bot-mcp-servers/${segment(serverId)}/update`,
        'POST',
        body,
        options,
      )
    },
    /**
     * 测试已配置的 MCP 连接及工具发现。
     * @param serverId 远程 MCP 服务标识。
     * @param options 取消信号和可选的幂等标识。
     * @returns 校验后的平台响应，业务失败时拒绝。
     */
    async testBotMcpServer(serverId: string, options: ApiCallOptions = {}) {
      return callTyped<ApiSuccessData<'/api/v1/bot-mcp-servers/{serverId}/test', 'post'>>(
        `/api/v1/bot-mcp-servers/${segment(serverId)}/test`,
        'POST',
        undefined,
        options,
      )
    },
    /**
     * 读取当前月份或指定月份的团队用量与预算。
     * @param teamId 团队标识。
     * @param query 筛选与分页条件。
     * @param options 取消信号和可选的幂等标识。
     * @returns 校验后的平台响应，业务失败时拒绝。
     */
    async getBotUsage(
      teamId: string,
      query?: ApiQuery<'/api/v1/teams/{teamId}/bot-usage', 'get'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/teams/{teamId}/bot-usage', 'get'>>(
        `/api/v1/teams/${segment(teamId)}/bot-usage`,
        'GET',
        undefined,
        { ...options, query },
      )
    },
    /**
     * 设置或取消团队月度预算。
     * @param teamId 团队标识。
     * @param body 当前操作的请求数据。
     * @param options 取消信号和可选的幂等标识。
     * @returns 校验后的平台响应，业务失败时拒绝。
     */
    async updateBotBudget(
      teamId: string,
      body: ApiBody<'/api/v1/teams/{teamId}/bot-budget', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/teams/{teamId}/bot-budget', 'post'>>(
        `/api/v1/teams/${segment(teamId)}/bot-budget`,
        'POST',
        body,
        options,
      )
    },
    /**
     * 为指定 Bot 排入当天的记忆整理。
     * @param botId 智能体标识。
     * @param options 取消信号和可选的幂等标识。
     * @returns 校验后的平台响应，业务失败时拒绝。
     */
    async consolidateBotMemories(botId: string, options: ApiCallOptions = {}) {
      return callTyped<ApiSuccessData<'/api/v1/bots/{botId}/memories/consolidate', 'post'>>(
        `/api/v1/bots/${segment(botId)}/memories/consolidate`,
        'POST',
        undefined,
        options,
      )
    },
    /**
     * 执行成员发起的接力控制。
     * @param relayId 接力标识。
     * @param action 继续、结束或停止。
     * @param body 用于并发校验的接力版本。
     * @param options 取消信号和可选的幂等标识。
     * @returns 更新后的接力状态，发生冲突时拒绝。
     */
    async controlBotRelay(
      relayId: string,
      action: 'continue' | 'end' | 'stop',
      body: ApiBody<'/api/v1/bot-relays/{relayId}/continue', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/bot-relays/{relayId}/continue', 'post'>>(
        `/api/v1/bot-relays/${segment(relayId)}/${action}`,
        'POST',
        body,
        options,
      )
    },
    /**
     * 启停或移除远程 MCP 服务。
     * @param serverId 服务标识。
     * @param action 启用、停用或移除。
     * @param options 取消信号和可选的幂等标识。
     * @returns 操作对象的状态，业务失败时拒绝。
     */
    async controlBotMcpServer(serverId: string, action: 'enable' | 'disable' | 'remove', options: ApiCallOptions = {}) {
      return callTyped<ApiSuccessData<'/api/v1/bot-mcp-servers/{serverId}/enable', 'post'>>(
        `/api/v1/bot-mcp-servers/${segment(serverId)}/${action}`,
        'POST',
        {},
        options,
      )
    },
    /** 读取会话任务列表。 */
    async listBotTasks(
      conversationId: string,
      query?: ApiQuery<'/api/v1/bot-conversations/{conversationId}/tasks', 'get'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/bot-conversations/{conversationId}/tasks', 'get'>>(
        `/api/v1/bot-conversations/${segment(conversationId)}/tasks`,
        'GET',
        undefined,
        { ...options, query },
      )
    },
    /** 创建会话任务并尝试安排首次运行。 */
    async createBotTask(
      conversationId: string,
      body: ApiBody<'/api/v1/bot-conversations/{conversationId}/tasks', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/bot-conversations/{conversationId}/tasks', 'post'>>(
        `/api/v1/bot-conversations/${segment(conversationId)}/tasks`,
        'POST',
        body,
        options,
      )
    },
    /** 查看任务和最近的运行轨迹。 */
    async getBotTask(taskId: string, options: ApiCallOptions = {}) {
      return callTyped<ApiSuccessData<'/api/v1/bot-tasks/{taskId}', 'get'>>(
        `/api/v1/bot-tasks/${segment(taskId)}`,
        'GET',
        undefined,
        options,
      )
    },
    /** 为等待中的任务补充执行要求。 */
    async appendBotTask(
      taskId: string,
      body: ApiBody<'/api/v1/bot-tasks/{taskId}/append', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/bot-tasks/{taskId}/append', 'post'>>(
        `/api/v1/bot-tasks/${segment(taskId)}/append`,
        'POST',
        body,
        options,
      )
    },
    /** 将任务转交给另一位会话内智能体。 */
    async handoffBotTask(
      taskId: string,
      body: ApiBody<'/api/v1/bot-tasks/{taskId}/handoff', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/bot-tasks/{taskId}/handoff', 'post'>>(
        `/api/v1/bot-tasks/${segment(taskId)}/handoff`,
        'POST',
        body,
        options,
      )
    },
    /** 使用当前任务输入创建一次新的运行。 */
    async rerunBotTask(
      taskId: string,
      body: ApiBody<'/api/v1/bot-tasks/{taskId}/rerun', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/bot-tasks/{taskId}/rerun', 'post'>>(
        `/api/v1/bot-tasks/${segment(taskId)}/rerun`,
        'POST',
        body,
        options,
      )
    },
    /** 结束任务并请求其在途运行停止。 */
    async cancelBotTask(
      taskId: string,
      body: ApiBody<'/api/v1/bot-tasks/{taskId}/cancel', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/bot-tasks/{taskId}/cancel', 'post'>>(
        `/api/v1/bot-tasks/${segment(taskId)}/cancel`,
        'POST',
        body,
        options,
      )
    },
    /** 停止正在排队或执行的 Bot 运行。 */
    async stopBotRun(runId: string, options: ApiCallOptions = {}) {
      return callTyped<ApiSuccessData<'/api/v1/bot-runs/{runId}/stop', 'post'>>(
        `/api/v1/bot-runs/${segment(runId)}/stop`,
        'POST',
        undefined,
        options,
      )
    },
    /** 列出当前成员可见的待验收和受阻任务。 */
    async getBotInbox(teamId: string, options: ApiCallOptions = {}) {
      return callTyped<ApiSuccessData<'/api/v1/teams/{teamId}/bot-inbox', 'get'>>(
        `/api/v1/teams/${segment(teamId)}/bot-inbox`,
        'GET',
        undefined,
        options,
      )
    },
    /** 验收任务的最新结果。 */
    async acceptBotTask(
      taskId: string,
      body: ApiBody<'/api/v1/bot-tasks/{taskId}/accept', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/bot-tasks/{taskId}/accept', 'post'>>(
        `/api/v1/bot-tasks/${segment(taskId)}/accept`,
        'POST',
        body,
        options,
      )
    },
    /** 退回任务结果并说明原因。 */
    async requestBotTaskChanges(
      taskId: string,
      body: ApiBody<'/api/v1/bot-tasks/{taskId}/request-changes', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/bot-tasks/{taskId}/request-changes', 'post'>>(
        `/api/v1/bot-tasks/${segment(taskId)}/request-changes`,
        'POST',
        body,
        options,
      )
    },
    /** 分页读取当前团队的工作标签。 */
    async listWorkTags(
      teamId: string,
      query?: ApiQuery<'/api/v1/teams/{teamId}/work-tags', 'get'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/teams/{teamId}/work-tags', 'get'>>(
        `/api/v1/teams/${segment(teamId)}/work-tags`,
        'GET',
        undefined,
        { ...options, query },
      )
    },
    /** 新建或复用规范化名称相同的标签。 */
    async createWorkTag(
      teamId: string,
      body: ApiBody<'/api/v1/teams/{teamId}/work-tags', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/teams/{teamId}/work-tags', 'post'>>(
        `/api/v1/teams/${segment(teamId)}/work-tags`,
        'POST',
        body,
        options,
      )
    },
    /** 修改标签名称，保留它与相关资源的关联。 */
    async renameWorkTag(
      id: string,
      body: ApiBody<'/api/v1/work-tags/{tagId}/update', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/work-tags/{tagId}/update', 'post'>>(
        `/api/v1/work-tags/${segment(id)}/update`,
        'POST',
        body,
        options,
      )
    },
    /** 删除工作标签和其引用关系。 */
    async removeWorkTag(id: string, options: ApiCallOptions = {}) {
      return callTyped<ApiSuccessData<'/api/v1/work-tags/{tagId}/remove', 'post'>>(
        `/api/v1/work-tags/${segment(id)}/remove`,
        'POST',
        undefined,
        options,
      )
    },
    /** 添加或取消对会话或任务的一项标签关联。 */
    async setWorkTagLink(
      id: string,
      linked: boolean,
      body: ApiBody<'/api/v1/work-tags/{tagId}/link', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/work-tags/{tagId}/link', 'post'>>(
        `/api/v1/work-tags/${segment(id)}/${linked ? 'link' : 'unlink'}`,
        'POST',
        body,
        options,
      )
    },
    /** 查询当前可见的 Bot 笔记与本人画像。 */
    async listBotMemories(
      teamId: string,
      query?: ApiQuery<'/api/v1/teams/{teamId}/bot-memories', 'get'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/teams/{teamId}/bot-memories', 'get'>>(
        `/api/v1/teams/${segment(teamId)}/bot-memories`,
        'GET',
        undefined,
        { ...options, query },
      )
    },
    /** 保存一条当前成员有权新增的记忆。 */
    async createBotMemory(
      teamId: string,
      body: ApiBody<'/api/v1/teams/{teamId}/bot-memories', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/teams/{teamId}/bot-memories', 'post'>>(
        `/api/v1/teams/${segment(teamId)}/bot-memories`,
        'POST',
        body,
        options,
      )
    },
    /** 修改记忆正文或常驻状态。 */
    async updateBotMemory(
      id: string,
      body: ApiBody<'/api/v1/bot-memories/{memoryId}/update', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/bot-memories/{memoryId}/update', 'post'>>(
        `/api/v1/bot-memories/${segment(id)}/update`,
        'POST',
        body,
        options,
      )
    },
    /** 删除一条当前成员可修改的记忆。 */
    async removeBotMemory(id: string, options: ApiCallOptions = {}) {
      return callTyped<ApiSuccessData<'/api/v1/bot-memories/{memoryId}/remove', 'post'>>(
        `/api/v1/bot-memories/${segment(id)}/remove`,
        'POST',
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

    /** 读取项目写能力调用记录。 */
    async listToolInvocations(projectId: string, options: ApiCallOptions = {}) {
      return callTyped<ApiSuccessData<'/api/v1/projects/{projectId}/tools/invocations', 'get'>>(
        `/api/v1/projects/${projectId}/tools/invocations`,
        'GET',
        undefined,
        options,
      )
    },
    /** 查询当前用户的项目写能力。 */
    async getToolCapabilities(projectId: string, options: ApiCallOptions = {}) {
      return callTyped<ApiSuccessData<'/api/v1/projects/{projectId}/tools/capabilities', 'get'>>(
        `/api/v1/projects/${segment(projectId)}/tools/capabilities`,
        'GET',
        undefined,
        options,
      )
    },
    /** 读取项目写能力授权列表。 */
    async listToolGrants(projectId: string, options: ApiCallOptions = {}) {
      return callTyped<ApiSuccessData<'/api/v1/projects/{projectId}/tools/grants', 'get'>>(
        `/api/v1/projects/${segment(projectId)}/tools/grants`,
        'GET',
        undefined,
        options,
      )
    },
    /** 授予项目写能力。 */
    async grantToolCapability(
      projectId: string,
      body: ApiBody<'/api/v1/projects/{projectId}/tools/grants', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/projects/{projectId}/tools/grants', 'post'>>(
        `/api/v1/projects/${segment(projectId)}/tools/grants`,
        'POST',
        body,
        options,
      )
    },
    /** 撤销项目写能力授权。 */
    async revokeToolGrant(
      projectId: string,
      grantId: string,
      body: ApiBody<'/api/v1/projects/{projectId}/tools/grants/{grantId}/revoke', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/projects/{projectId}/tools/grants/{grantId}/revoke', 'post'>>(
        `/api/v1/projects/${segment(projectId)}/tools/grants/${segment(grantId)}/revoke`,
        'POST',
        body,
        options,
      )
    },
    /** 发起受控代码修改。 */
    async createCodeChange(
      projectId: string,
      body: ApiBody<'/api/v1/projects/{projectId}/tools/code-changes', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/projects/{projectId}/tools/code-changes', 'post'>>(
        `/api/v1/projects/${segment(projectId)}/tools/code-changes`,
        'POST',
        body,
        options,
      )
    },
    /** 读取项目代码变更列表。 */
    async listCodeChanges(projectId: string, options: ApiCallOptions = {}) {
      return callTyped<ApiSuccessData<'/api/v1/projects/{projectId}/tools/code-changes', 'get'>>(
        `/api/v1/projects/${segment(projectId)}/tools/code-changes`,
        'GET',
        undefined,
        options,
      )
    },
    /** 读取代码变更详情。 */
    async getCodeChange(codeChangeId: string, options: ApiCallOptions = {}) {
      return callTyped<ApiSuccessData<'/api/v1/tools/code-changes/{codeChangeId}', 'get'>>(
        `/api/v1/tools/code-changes/${segment(codeChangeId)}`,
        'GET',
        undefined,
        options,
      )
    },
    /** 读取代码差异。 */
    async getCodeChangeDiff(codeChangeId: string, options: ApiCallOptions = {}) {
      return callTyped<ApiSuccessData<'/api/v1/tools/code-changes/{codeChangeId}/diff', 'get'>>(
        `/api/v1/tools/code-changes/${segment(codeChangeId)}/diff`,
        'GET',
        undefined,
        options,
      )
    },
    /** 取消代码变更。 */
    async cancelCodeChange(
      codeChangeId: string,
      body: ApiBody<'/api/v1/tools/code-changes/{codeChangeId}/cancel', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/tools/code-changes/{codeChangeId}/cancel', 'post'>>(
        `/api/v1/tools/code-changes/${segment(codeChangeId)}/cancel`,
        'POST',
        body,
        options,
      )
    },
    /** 为代码变更创建远端 PR。 */
    async createCodeChangePullRequest(
      codeChangeId: string,
      body: ApiBody<'/api/v1/tools/code-changes/{codeChangeId}/pull-requests', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/tools/code-changes/{codeChangeId}/pull-requests', 'post'>>(
        `/api/v1/tools/code-changes/${segment(codeChangeId)}/pull-requests`,
        'POST',
        body,
        options,
      )
    },
    /** 创建远端 Issue 并关联本地 Bug。 */
    async createRemoteIssue(
      projectId: string,
      body: ApiBody<'/api/v1/projects/{projectId}/tools/remote-issues', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/projects/{projectId}/tools/remote-issues', 'post'>>(
        `/api/v1/projects/${segment(projectId)}/tools/remote-issues`,
        'POST',
        body,
        options,
      )
    },
    /** 添加本地事项或远端记录评论。 */
    async addToolComment(
      projectId: string,
      body: ApiBody<'/api/v1/projects/{projectId}/tools/comments', 'post'>,
      options: ApiCallOptions = {},
    ) {
      return callTyped<ApiSuccessData<'/api/v1/projects/{projectId}/tools/comments', 'post'>>(
        `/api/v1/projects/${segment(projectId)}/tools/comments`,
        'POST',
        body,
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
