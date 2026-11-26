import { setColorMode, useColorMode, type ColorMode } from '@/shared/model/color-mode'
import { Input } from '@/shared/ui/controls/input'
import { useToast } from '@/shared/ui/toast'
import './profile-color-mode.css'

const colorModes: ReadonlyArray<{ mode: ColorMode; label: string }> = [
  { mode: 'system', label: '跟随系统' },
  { mode: 'light', label: '浅色' },
  { mode: 'dark', label: '深色' },
]

function ColorPreview({ palette }: { palette: 'light' | 'dark' }) {
  return (
    <span className="profile-color-preview-art" data-color-preview={palette}>
      <span className="profile-color-preview-nav">
        <span />
        <span />
        <span />
      </span>
      <span className="profile-color-preview-content">
        <span className="profile-color-preview-user" />
        <span className="profile-color-preview-line" />
        <span className="profile-color-preview-line" />
        <span className="profile-color-preview-composer" />
      </span>
    </span>
  )
}

/**
 * 渲染个人设置中的配色选择，使用本机系统设置或显式的浅色、深色。
 * @returns 有键盘和触屏支持的预览单选组。存储受限时提示本次选择的保存情况。
 */
export function ProfileColorMode() {
  const selected = useColorMode()
  const { showToast } = useToast()
  return (
    <section className="settings-section" aria-labelledby="profile-color-mode">
      <div className="settings-heading">
        <h2 id="profile-color-mode">配色模式</h2>
      </div>
      <div className="profile-color-modes" role="radiogroup" aria-labelledby="profile-color-mode">
        {colorModes.map(({ mode, label }) => (
          <label className="profile-color-option" key={mode}>
            <Input
              type="radio"
              className="sr-only size-px"
              name="profile-color-mode"
              value={mode}
              checked={selected === mode}
              onChange={() => {
                if (!setColorMode(mode)) showToast('配色已应用，浏览器未能保存该设置。', 'error')
              }}
            />
            <span className="profile-color-card">
              <span className="profile-color-preview" aria-hidden="true">
                <ColorPreview palette={mode === 'dark' ? 'dark' : 'light'} />
                {mode === 'system' && <ColorPreview palette="dark" />}
              </span>
              <span>{label}</span>
            </span>
          </label>
        ))}
      </div>
    </section>
  )
}
