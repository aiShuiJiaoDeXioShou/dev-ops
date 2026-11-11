import { describe, expect, it } from 'vitest'
import { isNestedInteractiveTarget } from './clickable'

function element(html: string): Element {
  const host = document.createElement('div')
  host.innerHTML = html
  document.body.append(host)
  return host
}

describe('isNestedInteractiveTarget', () => {
  it('内部按钮、链接与输入控件不触发整行/整卡点击', () => {
    const host = element('<button id="b">保存</button><a id="a" href="#x">链接</a><input id="i" />')
    for (const id of ['b', 'a', 'i']) {
      expect(isNestedInteractiveTarget(host.querySelector(`#${id}`))).toBe(true)
    }
  })

  it('普通文本与装饰元素允许整行/整卡点击', () => {
    const host = element('<span id="s">标题</span><div id="d"><span id="n">普通文本</span></div>')
    expect(isNestedInteractiveTarget(host.querySelector('#s'))).toBe(false)
    expect(isNestedInteractiveTarget(host.querySelector('#n'))).toBe(false)
    expect(isNestedInteractiveTarget(null)).toBe(false)
  })
})
