import { expect, test } from '@playwright/test'
import { apiFixtures, VISUAL_IDS } from './fixtures'
import { installApiMocks } from './mock-api'

test('[desktop] [mobile] 项目流程模板分类型编辑节点并保留新顺序', async ({ page }, testInfo) => {
  await installApiMocks(page)
  const projectPath = '/api/v1/projects/' + VISUAL_IDS.projectId
  const fixture = apiFixtures[projectPath]
  if (
    !fixture ||
    typeof fixture !== 'object' ||
    !('data' in fixture) ||
    !fixture.data ||
    typeof fixture.data !== 'object'
  )
    throw new Error('缺少项目详情数据')
  let project = { ...fixture.data, version: 1, workItemTemplates: {} }
  await page.route('**' + projectPath, (route) => route.fulfill({ json: { ...fixture, data: project } }))
  await page.route('**' + projectPath + '/update', (route) => {
    const body = route.request().postDataJSON()
    expect(body.version).toBe(project.version)
    expect(body.workItemTemplate.kind).toBe('requirement')
    expect(body.workItemTemplate.nodes.map((node: { title: string }) => node.title)).toEqual([
      '需求评估',
      '发布审核',
      '开发',
      '待测试',
      '测试',
      '已通过',
    ])
    project = {
      ...project,
      version: project.version + 1,
      workItemTemplates: { ...project.workItemTemplates, requirement: body.workItemTemplate.nodes },
    }
    return route.fulfill({ json: { ...fixture, data: project } })
  })
  await page.goto('/projects/' + VISUAL_IDS.projectId + '/requirements')
  await page.getByRole('button', { name: '项目设置', exact: true }).click()
  const settings = page.getByRole('dialog', { name: '项目设置' })
  await settings.getByRole('tab', { name: '流程模板' }).click()
  const type = settings.getByRole('combobox', { name: '事项类型' })
  const firstNode = settings.getByRole('textbox', { name: '节点 1 名称' })
  await firstNode.fill('需求评估')
  await settings.getByRole('button', { name: '新增节点' }).click()
  const customNode = settings.getByRole('textbox', { name: '节点 6 名称' })
  await expect(customNode).toBeFocused()
  await customNode.fill('发布审核')
  const more = settings.getByRole('button', { name: '发布审核 节点操作' })
  for (let step = 0; step < 4; step++) {
    await more.click()
    await page.getByRole('menuitem', { name: '前移' }).click()
  }
  const positionedNode = settings.getByRole('textbox', { name: '节点 2 名称' })
  await expect(positionedNode).toHaveValue('发布审核')
  expect((await positionedNode.boundingBox())?.width ?? 0).toBeGreaterThan(140)
  await type.selectOption('bug')
  await expect(firstNode).toHaveValue('待处理')
  await type.selectOption('requirement')
  await expect(firstNode).toHaveValue('需求评估')
  await settings.getByRole('button', { name: '保存模板' }).click()
  await expect(page.getByText('流程模板已保存。')).toBeVisible()
  await expect(settings.getByRole('button', { name: '保存模板' })).toBeDisabled()
  await page.screenshot({ path: testInfo.outputPath('project-work-item-template.png'), animations: 'disabled' })
})
