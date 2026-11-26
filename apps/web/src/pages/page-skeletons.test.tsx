import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AuthPageSkeleton, RoutePageSkeleton } from './page-skeletons'

describe('页面专属骨架屏', () => {
  it.each([
    ['/collaboration', '.collab-layout'],
    ['/projects', '.project-home'],
    ['/projects/p1/requirements', '.project-header'],
    ['/projects/p1/code', '.project-header'],
    ['/projects/p1/prs', '.project-header'],
    ['/projects/p1/pipelines', '.project-header'],
    ['/projects/p1/pipelines/run-1', '.project-header'],
    ['/projects/p1/artifacts', '.project-header'],
    ['/projects/p1/environment', '.project-header'],
    ['/capabilities/bots', '.capability-nav'],
    ['/capabilities/skills', '.skills-catalog'],
    ['/capabilities/memory', '.memory-card'],
    ['/capabilities/prompt-templates', '.work-toolbar'],
    ['/vault', '.catalog'],
    ['/settings/profile', '.settings-form-width'],
    ['/settings/team', '.team-page-head'],
    ['/settings/pipeline-nodes', '.catalog'],
    ['/platform', '.content'],
    ['/system/status', '.catalog'],
  ])('路由 %s 渲染专属结构化骨架且不包含可见加载文案', (pathname, expectedSelector) => {
    const { container } = render(<RoutePageSkeleton pathname={pathname} delay={0} />)
    expect(container.querySelector(expectedSelector)).toBeInTheDocument()
    expect(container.querySelectorAll('.react-loading-skeleton').length).toBeGreaterThan(0)
    // react-loading-skeleton 使用零宽空格撑高，去掉不可见字符后不应存在任何“加载中”可见文本。
    const visibleText = (container.textContent ?? '').replace(/[\u200c\s]+/g, '')
    expect(visibleText).toBe('')
    expect(screen.getAllByRole('status').length).toBeGreaterThan(0)
  })

  it('认证页渲染双栏登录骨架且无可见加载文字', () => {
    const { container } = render(<AuthPageSkeleton delay={0} />)
    expect(container.querySelector('.login-shell')).toBeInTheDocument()
    expect(container.querySelectorAll('.react-loading-skeleton').length).toBeGreaterThan(0)
    const visibleText = (container.textContent ?? '').replace(/[\u200c\s]+/g, '')
    expect(visibleText).toBe('')
  })
})
