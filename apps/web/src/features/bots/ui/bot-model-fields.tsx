import { useId } from 'react'
import { Button } from '@/shared/ui/controls/button'
import { Select } from '@/shared/ui/controls/select'
import type { useBotModelSelection } from '../model/use-bot-model-selection'

/**
 * 渲染创建和绑定弹窗共用的模型选择字段及查询反馈。
 * @param props 选择状态、可选配置及表单提交状态。
 * @returns 带关联标签的连接和模型选择框。
 */
export function BotModelFields({
  selection,
  isOptional = false,
  isSaving,
}: {
  selection: ReturnType<typeof useBotModelSelection>
  isOptional?: boolean
  isSaving: boolean
}) {
  const id = useId()
  const { connections, available, selected, catalog, models } = selection
  const hasUnavailableSelection = connections.isSuccess && !!selection.connectionId && !selected
  const canSelectModel = !!selected && catalog.isSuccess
  let connectionPlaceholder = isOptional ? '稍后绑定' : '请选择可用连接'
  if (connections.isPending) connectionPlaceholder = '正在加载连接…'
  if (connections.isError) connectionPlaceholder = '模型连接加载失败'
  const modelPlaceholder = selected && catalog.isPending ? '正在加载模型…' : '请选择模型'

  return (
    <>
      <label className="field" htmlFor={`${id}-connection`}>
        <span>模型连接</span>
        <Select
          id={`${id}-connection`}
          value={hasUnavailableSelection || selected ? selection.connectionId : ''}
          disabled={isSaving || connections.isPending || connections.isError}
          onChange={(event) => selection.selectConnection(event.target.value)}
          required={!isOptional}
        >
          <option value="">{connectionPlaceholder}</option>
          {hasUnavailableSelection && <option value={selection.connectionId}>所选连接已不可用</option>}
          {available.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </Select>
      </label>
      <label className="field" htmlFor={`${id}-model`}>
        <span>{isOptional ? '默认模型' : '模型'}</span>
        <Select
          id={`${id}-model`}
          value={models.some((model) => model.modelId === selection.modelId) ? selection.modelId : ''}
          disabled={isSaving || !canSelectModel}
          onChange={(event) => selection.setModelId(event.target.value)}
          required={!!selected}
        >
          <option value="">{modelPlaceholder}</option>
          {models.map((model) => (
            <option key={model.modelId} value={model.modelId}>
              {model.displayName}
            </option>
          ))}
        </Select>
      </label>
      {connections.isSuccess && available.length === 0 && (
        <p className="full quiet small">在「团队管理 → 模型配置」添加可用模型连接。</p>
      )}
      {canSelectModel && models.length === 0 && <p className="full quiet small">所选连接暂无可用模型。</p>}
      {(connections.isError || catalog.isError) && (
        <div className="full row flex-wrap">
          <p role="status" className="quiet small">
            {connections.isError ? '模型连接加载失败。' : '模型目录加载失败。'}
          </p>
          <Button
            type="button"
            variant="outline"
            disabled={isSaving || connections.isFetching || catalog.isFetching}
            onClick={() => {
              if (connections.isError) void connections.refetch()
              else void catalog.refetch()
            }}
          >
            重试加载
          </Button>
        </div>
      )}
    </>
  )
}
