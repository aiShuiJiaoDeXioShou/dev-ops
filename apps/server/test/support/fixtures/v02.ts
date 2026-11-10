/** V0.2 测试用构建、服务、凭据与环境变量样例；不包含真实敏感值。 */
export const buildReportFixture = {
  versionLabel: '1.0.0',
  source: 'pipeline' as const,
  buildKey: 'ci-100',
  collectedAt: '2026-11-10T08:00:00.000Z',
  resultStatus: 'succeeded' as const,
  note: '测试构建',
  artifacts: [
    { artifactType: 'web_test_url' as const, accessUrl: 'https://test.example.test/app' },
    { artifactType: 'mobile_package' as const, accessUrl: 'https://test.example.test/app.apk' },
    { artifactType: 'mini_program_qr' as const, accessUrl: 'https://test.example.test/qr.png' },
  ],
}

export const credentialFixture = {
  name: '测试部署密钥',
  kind: 'api_key' as const,
  description: '仅用于测试',
  value: 'test-only-value',
}

export const envVarFixture = {
  environment: 'test' as const,
  name: 'DEPLOY_TARGET',
  kind: 'plain' as const,
  value: 'staging',
}
