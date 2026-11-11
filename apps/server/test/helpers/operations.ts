/**
 * 运维/写能力集成测试辅助：复用流水线测试上下文与信封断言，并集中构造部署计划请求体。
 * 页面与接口仍通过真实 HTTP 注入，不直接调用 service。
 */
export {
  TEST_COMMIT_SHA,
  VALID_WORKFLOW,
  asRecord,
  expectFailure,
  expectSuccess,
  injectJson,
  items,
  setupPipelineContext,
  stringField,
  type PipelineTestContext,
  type TestActor,
  type TestEnvelope,
  type TestResponse,
} from '../integration/pipeline-harness.ts'

/** 构造部署类变更计划请求体；测试可按需覆盖字段。 */
export function changePlanBody(serviceId: string, versionLabel: string, overrides: Record<string, unknown> = {}) {
  return {
    operationKind: 'deploy_version',
    environment: 'test',
    serviceId,
    targetResource: 'web',
    versionLabel,
    scopeSummary: `部署测试环境 ${versionLabel}，仅替换应用容器`,
    evidence: '流水线校验通过',
    rollbackPlan: '回滚到上一版本',
    executionMode: 'platform_pipeline',
    workflowPath: '.devops/workflows/deploy-test.yml',
    workflowRef: 'main',
    ...overrides,
  }
}
