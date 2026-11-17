import { expect, test } from '@playwright/test'
import type { ApiSuccessData } from '@dev-ops/api-client'
import { VISUAL_IDS } from './fixtures'
import { installApiMocks } from './mock-api'

type Connection = ApiSuccessData<'/api/v1/teams/{teamId}/bot-model-connections', 'get'>[number]

function success(data: unknown) {
  return { success: true, code: 'OK', message: 'OK', requestId: 'model-visual', data }
}

test('[desktop] [mobile] 模型连接创建与订阅授权交互', async ({ page }, testInfo) => {
  await installApiMocks(page)
  const { teamId } = VISUAL_IDS
  const connections: Connection[] = []
  const sessionId = 'da55aa00-0000-4000-8000-000000000012'
  let answered = false
  await page.route(`**/api/v1/teams/${teamId}/credentials*`, (route) =>
    route.fulfill({
      json: success({ items: [], page: 1, pageSize: 100, total: 0 }),
    }),
  )
  await page.route(`**/api/v1/teams/${teamId}/bot-model-catalog*`, (route) =>
    route.fulfill({
      json: success([
        {
          providerId: 'deepseek',
          modelId: 'deepseek-flash',
          displayName: 'DeepSeek Flash',
          authTypes: ['api_key'],
          contextWindow: 8192,
        },
        {
          providerId: 'openai-codex',
          modelId: 'fixture',
          displayName: '订阅模型',
          authTypes: ['oauth'],
          contextWindow: 8192,
        },
      ]),
    }),
  )
  await page.route(`**/api/v1/teams/${teamId}/bot-model-connections`, (route) => {
    if (route.request().method() !== 'POST') return route.fulfill({ json: success(connections) })
    expect(route.request().postDataJSON()).toEqual({
      providerId: 'deepseek',
      name: '团队 DeepSeek',
      apiKey: 'fixture-only',
    })
    const created: Connection = {
      id: 'da55aa00-0000-4000-8000-000000000013',
      providerId: 'deepseek',
      name: '团队 DeepSeek',
      authType: 'api_key',
      status: 'active',
      disabledReason: null,
      loginUserName: null,
      version: 1,
      updatedAt: '2026-11-17T08:00:00.000Z',
    }
    connections.push(created)
    return route.fulfill({ json: success(created) })
  })
  await page.route(`**/api/v1/teams/${teamId}/bot-model-connections/oauth-login`, (route) =>
    route.fulfill({ json: success({ loginSessionId: sessionId }) }),
  )
  const getSession = () => ({
    id: sessionId,
    status: answered ? 'succeeded' : 'waiting_user',
    expiresAt: '2026-11-17T08:10:00.000Z',
    prompt: answered
      ? null
      : { url: 'https://auth.example.test/start', question: { kind: 'manual_code', message: '授权验证码' } },
  })
  await page.route(`**/api/v1/bot-model-login-sessions/${sessionId}`, (route) =>
    route.fulfill({ json: success(getSession()) }),
  )
  await page.route(`**/api/v1/bot-model-login-sessions/${sessionId}/answer`, (route) => {
    expect(route.request().postDataJSON()).toEqual({ value: 'fixture-code' })
    answered = true
    return route.fulfill({ json: success(getSession()) })
  })

  await page.goto('/capabilities/connections')
  await expect(page.getByRole('heading', { name: '模型连接', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '添加模型连接' }).click()
  const form = page.getByRole('dialog', { name: '添加模型连接' })
  await form.getByLabel('连接名称').fill('团队 DeepSeek')
  await form.getByLabel('提供方').selectOption('deepseek')
  await form.getByLabel('API Key', { exact: true }).fill('fixture-only')
  await form.getByRole('button', { name: '保存连接' }).click()
  await expect(page.getByRole('heading', { name: '团队 DeepSeek' })).toBeVisible()
  await expect(page.getByText('fixture-only', { exact: true })).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('bot-connections.png') })

  await page.getByRole('button', { name: '添加模型连接' }).click()
  await form.getByLabel('连接名称').fill('团队订阅')
  await form.getByRole('combobox', { name: '连接方式', exact: true }).selectOption('oauth')
  await form.getByLabel('提供方').selectOption('openai-codex')
  await form.getByRole('button', { name: '发起登录' }).click()
  const login = page.getByRole('dialog', { name: '订阅登录' })
  await expect(login.getByRole('link', { name: '打开授权页面' })).toHaveAttribute(
    'href',
    'https://auth.example.test/start',
  )
  await login.getByLabel('授权验证码').fill('fixture-code')
  await login.getByRole('button', { name: '提交授权输入' }).click()
  await expect(login.getByText('订阅授权已完成。')).toBeVisible()
  await login.getByRole('button', { name: '完成' }).click()
  await expect(login).toBeHidden()
})
