import { describe, expect, it } from 'vitest'
import { memberFixture, sessionFixture, teamFixture } from './server'

describe('MSW 共享夹具', () => {
  it('返回会话、团队、成员与 Git 提供方', async () => {
    const session = await fetch('http://localhost/api/v1/auth/get-session').then((response) => response.json())
    expect(session.user).toEqual(sessionFixture.user)
    const teams = await fetch('http://localhost/api/v1/me/teams').then((response) => response.json())
    expect(teams.data).toEqual([teamFixture])
    const members = await fetch('http://localhost/api/v1/teams/team-1/members').then((response) => response.json())
    expect(members.data).toEqual([memberFixture])
    const providers = await fetch('http://localhost/api/v1/git-providers').then((response) => response.json())
    expect(providers.data.map((item: { providerKey: string }) => item.providerKey)).toEqual(['github', 'gitea'])
  })
})
