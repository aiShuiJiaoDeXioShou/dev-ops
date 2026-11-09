import { loadConfig, type AppConfig } from '../../src/platform/config/env.js'

/** 测试用数据库 URL；不连接真实数据库，仅通过配置校验。 */
export const TEST_DATABASE_URL = 'postgresql://test_user:unit_test@127.0.0.1:1/dev_ops_test'

/**
 * 创建确定性的测试配置。
 * @param overrides 覆盖默认测试变量，例如 APP_ORIGIN。
 * @returns 已通过校验的配置，默认静默日志并使用不可连接数据库。
 */
export function createTestConfig(overrides: NodeJS.ProcessEnv = {}): AppConfig {
  return loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: TEST_DATABASE_URL,
    DB_CONNECT_TIMEOUT_MS: '100',
    AUTH_SECRET: 'test-secret-at-least-32-characters-long',
    ...overrides,
  })
}
