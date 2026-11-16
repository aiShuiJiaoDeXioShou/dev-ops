import { useSearchParams } from 'react-router'
import { useSession } from '@/features/identity/model/session'
import { ApiTokenSection } from '@/features/identity/ui/api-token-section'
import { ChangePasswordDialog } from '@/features/identity/ui/change-password-dialog'
import { EditProfileDialog } from '@/features/identity/ui/edit-profile-dialog'
import { UserAvatar } from '@/shared/ui/user-avatar'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/controls/tabs'

/**
 * 渲染个人资料与 API Token 页签，并在 URL 中保留选中的页签。
 * @returns 个人页面，默认显示登录账号的资料。
 */
export function Component() {
  const { user, currentTeam } = useSession()
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = searchParams.get('tab') === 'tokens' ? 'tokens' : 'profile'

  return (
    <div className="catalog min-w-0">
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
          <section className="max-w-2xl divide-y rounded-xl border bg-card" aria-labelledby="profile-name">
            <div className="flex flex-wrap items-center justify-between gap-3 p-4 sm:p-5">
              <div className="flex min-w-0 items-center gap-3">
                <UserAvatar name={user.name} image={user.image} className="size-12 text-lg" />
                <h2 id="profile-name" className="mb-0 wrap-anywhere text-base font-semibold">
                  {user.name}
                </h2>
              </div>
              <EditProfileDialog user={user} />
            </div>
            <dl className="space-y-3 px-4 py-4 text-sm sm:px-5">
              <div className="grid gap-1 sm:grid-cols-4 sm:gap-3">
                <dt className="text-muted-foreground">邮箱</dt>
                <dd className="wrap-anywhere sm:col-span-3">{user.email}</dd>
              </div>
              <div className="grid gap-1 sm:grid-cols-4 sm:gap-3">
                <dt className="text-muted-foreground">当前团队</dt>
                <dd className="wrap-anywhere sm:col-span-3">{currentTeam?.name ?? '未加入团队'}</dd>
              </div>
            </dl>
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5">
              <span className="text-sm font-medium">登录密码</span>
              <ChangePasswordDialog />
            </div>
          </section>
        </TabsContent>
        <TabsContent value="tokens">{tab === 'tokens' && <ApiTokenSection />}</TabsContent>
      </Tabs>
    </div>
  )
}

export default Component
