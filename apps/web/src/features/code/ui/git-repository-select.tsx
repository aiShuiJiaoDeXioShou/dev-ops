import { useId, useState } from 'react'
import { Combobox } from '@/shared/ui/controls/combobox'
import { Select } from '@/shared/ui/controls/select'

type Repository = { id: string; connectionId: string; providerKey: string; namespace: string; name: string }
type Connection = { id: string; name: string; providerKey: string }

const providerNames: Record<string, string> = { github: 'GitHub', gitea: 'Gitea' }

function connectionLabel(connection: Connection): string {
  const provider = providerNames[connection.providerKey] ?? connection.providerKey
  return connection.name.startsWith(provider) ? connection.name : `${provider} · ${connection.name}`
}

/**
 * 从团队连接选择仓库，同名仓库保留各自的来源账号。
 * @param props 可用仓库、连接、仓库选中状态与文案；optional 允许清除选择。
 * @returns 按连接筛选的仓库搜索选择器。
 */
export function GitRepositorySelect({
  repositories,
  connections,
  value,
  onValueChange,
  label,
  optional = false,
  disabled = false,
}: {
  repositories: Repository[]
  connections: Connection[]
  value: string
  onValueChange: (value: string) => void
  label: string
  optional?: boolean
  disabled?: boolean
}) {
  const id = useId()
  const [connectionId, setConnectionId] = useState('')
  const connectionIds = new Set(repositories.map((repository) => repository.connectionId))
  const sources = connections.filter((connection) => connectionIds.has(connection.id))
  const activeConnectionId = sources.some((source) => source.id === connectionId) ? connectionId : ''
  const connectionNames = new Map(sources.map((source) => [source.id, connectionLabel(source)]))
  const options = repositories
    .filter((repository) => !activeConnectionId || repository.connectionId === activeConnectionId)
    .map((repository) => ({
      value: repository.id,
      label: `${repository.namespace}/${repository.name}${
        sources.length > 1 && !activeConnectionId
          ? ` · ${connectionNames.get(repository.connectionId) ?? providerNames[repository.providerKey] ?? repository.providerKey}`
          : ''
      }`,
    }))
  if (optional) options.unshift({ value: '', label: '暂不关联仓库' })
  return (
    <div className="space-y-3">
      {sources.length > 1 && (
        <label className="block space-y-1.5 text-sm font-medium">
          <span className="block">来源连接</span>
          <Select
            className="w-full"
            value={activeConnectionId}
            disabled={disabled}
            onChange={(event) => {
              setConnectionId(event.target.value)
              onValueChange('')
            }}
          >
            <option value="">全部连接</option>
            {sources.map((source) => (
              <option key={source.id} value={source.id}>
                {connectionLabel(source)}
              </option>
            ))}
          </Select>
        </label>
      )}
      <div className="space-y-1.5">
        <label htmlFor={id} className="block text-sm font-medium">
          {label}
        </label>
        <Combobox
          id={id}
          value={value}
          onValueChange={onValueChange}
          options={options}
          placeholder={optional ? '暂不关联仓库' : '选择仓库'}
          searchPlaceholder="搜索仓库"
          emptyMessage="没有匹配的仓库"
          disabled={disabled}
          aria-label={label}
        />
      </div>
    </div>
  )
}
