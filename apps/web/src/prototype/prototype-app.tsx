import { Navigate, Route, Routes } from 'react-router'
import '@/prototype/styles/styles.css'
import '@/prototype/styles/workspace.css'
import '@/prototype/styles/product.css'
import '@/prototype/styles/markdown.css'
import '@/prototype/styles/ai-chat.css'
import '@/prototype/styles/annotation.css'
import '@/prototype/styles/v01.css'
import { PrototypeProvider } from '@/prototype/data/store'
import { PrototypeShell } from '@/prototype/layout/prototype-shell'
import { ProjectsPage } from '@/prototype/pages/projects-page'
import { ProjectLayout } from '@/prototype/pages/project/project-layout'
import { ItemsPage } from '@/prototype/pages/project/items-page'
import { ProjectCollaborationPage } from '@/prototype/pages/project/project-collaboration-page'
import { CodePage } from '@/prototype/pages/project/code-page'
import { PullRequestsPage } from '@/prototype/pages/project/pull-requests-page'
import { PipelinesPage } from '@/prototype/pages/project/pipelines-page'
import { ArtifactsPage } from '@/prototype/pages/project/artifacts-page'
import { EnvironmentPage } from '@/prototype/pages/project/environment-page'
import { CapabilitiesLayout } from '@/prototype/pages/capabilities/capabilities-layout'
import { PrototypeNotFoundPage } from '@/prototype/pages/global-pages'
import { CollaborationPage } from '@/prototype/pages/collaboration-page'
import { OperationsPage } from '@/prototype/pages/operations-page'
import { VaultPage } from '@/prototype/pages/vault-page'
import { TeamAdminPage } from '@/prototype/pages/team-admin-page'
import { BotsPage } from '@/prototype/pages/capabilities/bots-page'
import { SkillsPage } from '@/prototype/pages/capabilities/skills-page'
import { TemplatesPage } from '@/prototype/pages/capabilities/templates-page'
import { MemoryPage } from '@/prototype/pages/capabilities/memory-page'
import { ConnectionsPage } from '@/prototype/pages/capabilities/connections-page'
import { V01HomePage } from '@/prototype/pages/v01/v01-home-page'
import {
  AcceptInvitationPage,
  ForgotPasswordPage,
  LoginPage,
  ResetPasswordPage,
} from '@/prototype/pages/auth/auth-pages'

/**
 * 原型应用入口：提供本地演示数据上下文与 `/prototype` 下的页面路由。
 * @returns 完整原型外壳；仅在开发环境注册到应用路由。
 */
export function Component() {
  return (
    <PrototypeProvider>
      <Routes>
        <Route path="auth" element={<Navigate to="login" replace />} />
        <Route path="auth/login" element={<LoginPage />} />
        <Route path="auth/accept-invitation" element={<AcceptInvitationPage />} />
        <Route path="auth/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="auth/reset-password" element={<ResetPasswordPage />} />
        <Route element={<PrototypeShell />}>
          <Route path="v01" element={<V01HomePage />} />
          <Route index element={<Navigate to="projects" replace />} />
          <Route path="projects" element={<ProjectsPage />} />
          <Route path="project/:projectId" element={<ProjectLayout />}>
            <Route index element={<Navigate to="requirements" replace />} />
            <Route path="requirements" element={<ItemsPage kind="需求" />} />
            <Route path="bugs" element={<ItemsPage kind="Bug" />} />
            <Route path="code" element={<CodePage />} />
            <Route path="collaboration" element={<ProjectCollaborationPage />} />
            <Route path="prs" element={<PullRequestsPage />} />
            <Route path="pipelines" element={<PipelinesPage />} />
            <Route path="artifacts" element={<ArtifactsPage />} />
            <Route path="environment" element={<EnvironmentPage />} />
          </Route>
          <Route path="collaboration" element={<CollaborationPage />} />
          <Route path="operations" element={<OperationsPage />} />
          <Route path="capabilities" element={<CapabilitiesLayout />}>
            <Route index element={<Navigate to="bots" replace />} />
            <Route path="bots" element={<BotsPage />} />
            <Route path="skills" element={<SkillsPage />} />
            <Route path="templates" element={<TemplatesPage />} />
            <Route path="memory" element={<MemoryPage />} />
            <Route path="connections" element={<ConnectionsPage />} />
          </Route>
          <Route path="vault" element={<VaultPage />} />
          <Route path="team-admin" element={<TeamAdminPage />} />
          <Route path="*" element={<PrototypeNotFoundPage />} />
        </Route>
      </Routes>
    </PrototypeProvider>
  )
}
