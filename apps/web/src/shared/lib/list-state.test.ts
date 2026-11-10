import { describe, expect, it } from 'vitest'
import { listStateKey, parseListState, toSearchParams, updateListState } from './list-state'

const defaults = { defaultPageSize: 20, statuses: ['pending', 'in_development', 'passed'] }

describe('list-state', () => {
  it('解析合法参数并回退非法值', () => {
    const params = new URLSearchParams('page=2&pageSize=50&search= 登录 &status=pending&ownerId=user-1&openId=req-1')
    expect(parseListState(params, defaults)).toEqual({
      page: 2,
      pageSize: 50,
      search: '登录',
      status: 'pending',
      ownerId: 'user-1',
      openId: 'req-1',
    })
    expect(parseListState(new URLSearchParams('page=0&pageSize=1000&status=unknown'), defaults)).toEqual({
      page: 1,
      pageSize: 100,
      search: '',
      status: '',
      ownerId: '',
      openId: null,
    })
  })

  it('序列化时省略默认值和空筛选', () => {
    expect(
      toSearchParams({ page: 1, pageSize: 20, search: '', status: '', ownerId: '', openId: null }, defaults).toString(),
    ).toBe('')
    expect(
      toSearchParams(
        {
          page: 3,
          pageSize: 50,
          search: '登录',
          status: 'pending',
          ownerId: 'user-1',
          openId: 'req-1',
        },
        defaults,
      ).toString(),
    ).toBe('page=3&pageSize=50&search=%E7%99%BB%E5%BD%95&status=pending&ownerId=user-1&openId=req-1')
  })

  it('筛选变化时回到第一页，翻页与关闭详情不触发', () => {
    const state = { page: 3, pageSize: 20, search: '', status: '', ownerId: '', openId: 'req-1' }
    expect(updateListState(state, { search: '登录' }).page).toBe(1)
    expect(updateListState(state, { status: 'pending' }).page).toBe(1)
    expect(updateListState(state, { page: 2 }).page).toBe(2)
    expect(updateListState(state, { openId: null }).page).toBe(3)
    expect(updateListState(state, { search: '' }).page).toBe(3)
  })

  it('查询键忽略 openId 且稳定', () => {
    const state = { page: 1, pageSize: 20, search: ' 登录 ', status: 'pending', ownerId: 'u', openId: 'a' }
    expect(listStateKey('requirements', state)).toEqual(['requirements', 'list', 1, 20, '登录', 'pending', 'u'])
    expect(listStateKey('requirements', { ...state, openId: 'b' })).toEqual(listStateKey('requirements', state))
  })
})
