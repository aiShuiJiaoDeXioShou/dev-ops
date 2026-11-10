import type { SuccessEnvelope } from './output.ts'
import { fetchEnvelope } from './http.ts'

export interface MeResponse {
  user: { id: string; name: string; email: string }
  teams: Array<{ id: string; name: string; role: 'admin' | 'developer' | 'viewer'; status: string }>
}

/** 读取当前 Token 对应的账号与团队。 */
export async function fetchMe(baseUrl: URL, timeoutMs: number, token: string): Promise<SuccessEnvelope<MeResponse>> {
  return fetchEnvelope<MeResponse>(baseUrl, timeoutMs, token, '/api/v1/me')
}
