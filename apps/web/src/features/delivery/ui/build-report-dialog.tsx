import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createIdempotencyKey, type ApiBody } from '@dev-ops/api-client'
import { apiClient } from '@/shared/api/client'
import { describeRequestError } from '@/shared/api/errors'
import { Button } from '@/shared/ui/controls/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/controls/dialog'
import { Input } from '@/shared/ui/controls/input'
import { Select } from '@/shared/ui/controls/select'
import { Textarea } from '@/shared/ui/controls/textarea'
import { useToast } from '@/shared/ui/toast'

type ReportBody = ApiBody<'/api/v1/projects/{projectId}/builds', 'post'>
type ArtifactType = 'mobile_package' | 'mini_program_qr' | 'web_test_url'
const ARTIFACT_TYPES: ReadonlyArray<{ value: ArtifactType; label: string }> = [
  { value: 'mobile_package', label: '移动端安装包' },
  { value: 'mini_program_qr', label: '小程序二维码' },
  { value: 'web_test_url', label: 'Web／后端测试地址' },
]
const EMPTY_ARTIFACT: { artifactType: ArtifactType; accessUrl: string } = {
  artifactType: 'web_test_url',
  accessUrl: '',
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * 人工上报构建与产物引用；与 CLI/API 使用同一后端校验。
 * @param props.projectId 目标项目；open/onOpenChange 控制弹窗；onSaved 成功后回调。
 * @returns 表单弹窗；提交失败保留输入并显示错误。
 */
export function BuildReportDialog({
  projectId,
  open,
  onOpenChange,
  onSaved,
}: {
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved?: (buildId: string) => void
}) {
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const [buildKey, setBuildKey] = useState('')
  const [versionLabel, setVersionLabel] = useState('')
  const [commitRef, setCommitRef] = useState('')
  const [environment, setEnvironment] = useState('')
  const [source, setSource] = useState<'manual' | 'pipeline' | 'local' | 'external_system'>('manual')
  const [collectedAt, setCollectedAt] = useState('')
  const [resultStatus, setResultStatus] = useState<'succeeded' | 'failed' | 'cancelled' | 'unknown'>('succeeded')
  const [note, setNote] = useState('')
  const [artifacts, setArtifacts] = useState([{ ...EMPTY_ARTIFACT }])
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setBuildKey('')
    setVersionLabel('')
    setCommitRef('')
    setEnvironment('')
    setSource('manual')
    setCollectedAt(new Date().toISOString())
    setResultStatus('succeeded')
    setNote('')
    setArtifacts([{ ...EMPTY_ARTIFACT }])
    setError('')
  }, [open])

  const mutation = useMutation({
    mutationFn: async (body: ReportBody) =>
      apiClient.reportBuild(projectId, body, { idempotencyKey: createIdempotencyKey() }),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['delivery'] })
      await queryClient.invalidateQueries({ queryKey: ['projects'] })
      showToast('构建记录已保存。', 'success')
      onOpenChange(false)
      onSaved?.(result.data.id)
    },
    onError: (cause: unknown) => {
      const message = describeRequestError(cause).description
      setError(message)
      showToast(message, 'error')
    },
  })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setError('')
    if (!buildKey.trim()) return setError('请填写构建标识。')
    if (!versionLabel.trim()) return setError('请填写版本标识。')
    if (!collectedAt || Number.isNaN(new Date(collectedAt).getTime())) return setError('请填写有效采集时间。')
    const filled = artifacts.filter((artifact) => artifact.accessUrl.trim().length > 0)
    if (filled.length === 0 && !note.trim()) return setError('至少提供一条产物引用或说明。')
    for (const artifact of filled) {
      if (!isHttpUrl(artifact.accessUrl.trim())) return setError('产物地址必须是完整的 http 或 https 地址。')
    }
    const body: ReportBody = {
      buildKey: buildKey.trim(),
      versionLabel: versionLabel.trim(),
      commitRef: commitRef.trim() || null,
      source,
      collectedAt: new Date(collectedAt).toISOString(),
      resultStatus,
      environment: environment === '' ? null : (environment as 'development' | 'test' | 'production'),
      note: note.trim() || null,
      artifacts: filled.map((artifact) => ({
        artifactType: artifact.artifactType,
        accessUrl: artifact.accessUrl.trim(),
      })),
    }
    mutation.mutate(body)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <form className="space-y-4" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>上报构建与产物</DialogTitle>
          </DialogHeader>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1.5 text-sm font-medium">
              构建标识
              <Input value={buildKey} onChange={(event) => setBuildKey(event.target.value)} maxLength={200} />
            </label>
            <label className="block space-y-1.5 text-sm font-medium">
              版本标识
              <Input value={versionLabel} onChange={(event) => setVersionLabel(event.target.value)} maxLength={200} />
            </label>
            <label className="block space-y-1.5 text-sm font-medium">
              提交标识（可选）
              <Input value={commitRef} onChange={(event) => setCommitRef(event.target.value)} maxLength={200} />
            </label>
            <label className="block space-y-1.5 text-sm font-medium">
              环境（可选）
              <Select value={environment} onChange={(event) => setEnvironment(event.target.value)}>
                <option value="">未指定</option>
                <option value="development">开发</option>
                <option value="test">测试</option>
                <option value="production">生产</option>
              </Select>
            </label>
            <label className="block space-y-1.5 text-sm font-medium">
              来源
              <Select value={source} onChange={(event) => setSource(event.target.value as typeof source)}>
                <option value="manual">人工</option>
                <option value="pipeline">流水线</option>
                <option value="local">本地构建</option>
                <option value="external_system">外部系统</option>
              </Select>
            </label>
            <label className="block space-y-1.5 text-sm font-medium">
              结果
              <Select
                value={resultStatus}
                onChange={(event) => setResultStatus(event.target.value as typeof resultStatus)}
              >
                <option value="succeeded">成功</option>
                <option value="failed">失败</option>
                <option value="cancelled">已取消</option>
                <option value="unknown">未知</option>
              </Select>
            </label>
            <label className="block space-y-1.5 text-sm font-medium sm:col-span-2">
              采集时间
              <Input
                type="datetime-local"
                value={collectedAt.slice(0, 16)}
                onChange={(event) => setCollectedAt(event.target.value)}
              />
            </label>
          </div>
          <label className="block space-y-1.5 text-sm font-medium">
            说明
            <Textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={2000} />
          </label>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">产物引用</legend>
            {artifacts.map((artifact, index) => (
              <div key={index} className="grid gap-2 sm:grid-cols-3">
                <Select
                  value={artifact.artifactType}
                  onChange={(event) =>
                    setArtifacts((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, artifactType: event.target.value as ArtifactType } : item,
                      ),
                    )
                  }
                >
                  {ARTIFACT_TYPES.map((type) => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </Select>
                <Input
                  placeholder="https://…"
                  value={artifact.accessUrl}
                  onChange={(event) =>
                    setArtifacts((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, accessUrl: event.target.value } : item,
                      ),
                    )
                  }
                />
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setArtifacts((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                  aria-label="删除产物"
                >
                  删除
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              onClick={() => setArtifacts((current) => [...current, { ...EMPTY_ARTIFACT }])}
            >
              添加产物
            </Button>
          </fieldset>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? '保存中…' : '保存'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
