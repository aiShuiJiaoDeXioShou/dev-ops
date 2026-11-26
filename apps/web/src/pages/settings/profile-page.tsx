import { useSearchParams } from 'react-router'
import { useSession } from '@/features/identity/model/session'
import { useGitHubAccountFeedback } from '@/features/identity/model/use-github-account-feedback'
import { ApiTokenSection } from '@/features/identity/ui/api-token-section'
import { ChangePasswordDialog } from '@/features/identity/ui/change-password-dialog'
import { EditProfileDialog } from '@/features/identity/ui/edit-profile-dialog'
import { GitHubAccountSection } from '@/features/identity/ui/github-account'
import { UserAvatar } from '@/shared/ui/user-avatar'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/controls/tabs'
import { ProfileColorMode } from './profile-color-mode'
import './settings-page.css'

/**
 * 渲染个人资料、配色设置与 API Token，并在 URL 中保留选中的页签。
 * @returns 个人页面，默认显示登录账号的资料。
 */
export function Component() {
  useGitHubAccountFeedback()
  const { user, currentTeam } = useSession()
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = searchParams.get('tab') === 'tokens' ? 'tokens' : 'profile'

  return (
    <div className="catalog settings-page">
      <header className="page-head border-b-0 p-0">
        <h1>个人页面</h1>
      </header>
      <Tabs
        value={tab}
        onValueChange={(value) => {
          const next = new URLSearchParams(searchParams)
          if (value === 'tokens') next.set('tab', 'tokens')
          else next.delete('tab')
          setSearchParams(next)
        }}
        className="settings-tabs"
      >
        <TabsList aria-label="个人页面分组">
          <TabsTrigger value="profile">个人资料</TabsTrigger>
          <TabsTrigger value="tokens">API Token</TabsTrigger>
        </TabsList>
        <TabsContent value="profile">
          <div className="settings-form-width">
            <section className="grid gap-4 pb-4" aria-labelledby="profile-basics">
              <div className="section-heading settings-heading">
                <h2 id="profile-basics">基本资料</h2>
                <EditProfileDialog user={user} />
              </div>
              <div className="flex items-center gap-3">
                <UserAvatar name={user.name} image={user.image} className="size-11 text-lg" />
                <h3 className="text-sm font-semibold wrap-anywhere">{user.name}</h3>
              </div>
              <dl className="space-y-2 text-sm">
                <div className="grid gap-1 sm:grid-cols-4 sm:gap-3">
                  <dt className="text-muted-foreground">邮箱</dt>
                  <dd className="wrap-anywhere sm:col-span-3">{user.email}</dd>
                </div>
                <div className="grid gap-1 sm:grid-cols-4 sm:gap-3">
                  <dt className="text-muted-foreground">当前团队</dt>
                  <dd className="wrap-anywhere sm:col-span-3">{currentTeam?.name ?? '未加入团队'}</dd>
                </div>
              </dl>
            </section>
            <ProfileColorMode />
            <section className="settings-section" aria-labelledby="profile-security">
              <div className="settings-heading">
                <h2 id="profile-security">登录安全</h2>
              </div>
              <div className="settings-profile-row">
                <span className="text-sm font-medium">登录密码</span>
                <ChangePasswordDialog />
              </div>
            </section>
            <section className="settings-section" aria-labelledby="profile-accounts">
              <div className="settings-heading">
                <h2 id="profile-accounts">关联账号</h2>
              </div>
              <GitHubAccountSection />
            </section>
          </div>
        </TabsContent>
        <TabsContent value="tokens">{tab === 'tokens' && <ApiTokenSection />}</TabsContent>
      </Tabs>
    </div>
  )
}

export default Component
