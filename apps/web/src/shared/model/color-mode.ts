import { useSyncExternalStore } from 'react'

export type ColorMode = 'system' | 'light' | 'dark'

const preferenceKey = 'devops.color-mode'
const preferenceEvent = 'devops:color-mode-change'
const darkSchemeQuery = '(prefers-color-scheme: dark)'

function parseColorMode(value: string | null | undefined): ColorMode {
  return value === 'light' || value === 'dark' ? value : 'system'
}

function currentColorMode() {
  return parseColorMode(document.documentElement.dataset.colorMode)
}

function storedColorMode() {
  try {
    return parseColorMode(window.localStorage.getItem(preferenceKey))
  } catch {
    // 浏览器限制本地存储时，仍可以按操作系统偏好选用配色。
    return 'system'
  }
}

function applyColorMode(mode: ColorMode, prefersDark: boolean) {
  const root = document.documentElement
  root.dataset.colorMode = mode
  root.classList.toggle('dark', mode === 'dark' || (mode === 'system' && prefersDark))
}

function publishColorMode(mode: ColorMode, prefersDark: boolean) {
  applyColorMode(mode, prefersDark)
  window.dispatchEvent(new Event(preferenceEvent))
}

function subscribe(listener: () => void) {
  window.addEventListener(preferenceEvent, listener)
  return () => window.removeEventListener(preferenceEvent, listener)
}

/**
 * 在应用挂载前应用保存的配色，随后监听系统主题和其他标签页的偏好变化。
 * @returns 无返回值。监听器随当前文档存活，仅在应用入口调用一次。
 */
export function initializeColorMode() {
  const system = window.matchMedia(darkSchemeQuery)
  applyColorMode(storedColorMode(), system.matches)
  system.addEventListener('change', (event) => {
    if (currentColorMode() === 'system') applyColorMode('system', event.matches)
  })
  window.addEventListener('storage', (event) => {
    if (event.key === preferenceKey || event.key === null) publishColorMode(storedColorMode(), system.matches)
  })
}

/**
 * 立即应用配色偏好并尝试保存到当前浏览器。
 * @param mode 跟随系统、浅色或深色。
 * @returns 是否保存成功。存储受限时本页仍会应用选择。
 */
export function setColorMode(mode: ColorMode) {
  publishColorMode(mode, window.matchMedia(darkSchemeQuery).matches)
  try {
    window.localStorage.setItem(preferenceKey, mode)
    return true
  } catch {
    return false
  }
}

/**
 * 订阅当前文档的配色偏好，用于同步主题选择控件。
 * @returns 所选模式。跟随系统时返回 system，实际配色由操作系统决定。
 */
export function useColorMode() {
  return useSyncExternalStore(subscribe, currentColorMode)
}
