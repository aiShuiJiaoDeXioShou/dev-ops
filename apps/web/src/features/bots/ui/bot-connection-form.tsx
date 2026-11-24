import { useId, useState } from 'react'
import { createIdempotencyKey } from '@dev-ops/api-client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/shared/api/client'
import { describeRequestError } from '@/shared/api/errors'
import { Button } from '@/shared/ui/controls/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFormBody,
  DialogFormFooter,
  DialogFormHeader,
  DialogTitle,
} from '@/shared/ui/controls/dialog'
import { Input } from '@/shared/ui/controls/input'
import { Select } from '@/shared/ui/controls/select'
import { FormSectionSkeleton } from '@/shared/ui/page-skeleton'
import { useToast } from '@/shared/ui/toast'
import { botQueryKey } from '../api/queries'
import { botCatalogOptions, connectionQueryKey } from '../api/connections'

function writeOptions() {
  return { idempotencyKey: createIdempotencyKey() }
}

function LoginStep({ sessionId, onDone, onClose }: { sessionId: string; onDone: () => void; onClose: () => void }) {
  const inputId = useId()
  const [answer, setAnswer] = useState('')
  const queryClient = useQueryClient()
  const queryKey = [...connectionQueryKey, 'login', sessionId]
  const progress = useQuery({
    queryKey,
    queryFn: ({ signal }) => apiClient.getBotOAuthLogin(sessionId, { signal }),
    refetchInterval: (query) => {
      const status = query.state.data?.data.status
      return status === 'succeeded' || status === 'failed' || status === 'expired' ? false : 1000
    },
  })
  const data = progress.data?.data
  const prompt = data?.prompt
  const question = prompt?.question
  const submit = useMutation({
    mutationFn: (value: string) => apiClient.answerBotOAuthLogin(sessionId, { value }, writeOptions()),
    onSuccess: () => {
      setAnswer('')
      void queryClient.invalidateQueries({ queryKey })
    },
  })
  const cancel = useMutation({
    mutationFn: () => apiClient.cancelBotOAuthLogin(sessionId, writeOptions()),
    onSuccess: onClose,
  })
  const finished = data?.status === 'succeeded' || data?.status === 'failed' || data?.status === 'expired'
  return (
    <>
      <DialogFormBody className="space-y-4">
        {progress.isPending && <FormSectionSkeleton fields={2} label="登录进度加载中" />}
        {progress.isError && (
          <Button variant="outline" type="button" onClick={() => void progress.refetch()}>
            重试查看登录进度
          </Button>
        )}
        {data?.status === 'succeeded' && <p role="status">订阅授权已完成。</p>}
        {data?.status === 'failed' && <p role="alert">授权失败，请重新发起登录。</p>}
        {data?.status === 'expired' && <p role="alert">授权已过期，请重新发起登录。</p>}
        {!finished && (
          <>
            <p role="status">{prompt?.message ?? '等待提供方返回授权指引。'}</p>
            {prompt?.url && (
              <a className="text-primary underline" href={prompt.url} target="_blank" rel="noreferrer">
                打开授权页面
              </a>
            )}
            {prompt?.userCode && (
              <p>
                设备码 <code>{prompt.userCode}</code>
              </p>
            )}
            {question && (
              <form
                className="space-y-3"
                onSubmit={(event) => {
                  event.preventDefault()
                  if (answer.trim() && !submit.isPending) submit.mutate(answer)
                }}
              >
                <label className="field" htmlFor={inputId}>
                  <span>{question.message}</span>
                  {question.kind === 'select' ? (
                    <Select id={inputId} value={answer} onChange={(event) => setAnswer(event.target.value)} required>
                      <option value="">请选择</option>
                      {question.options?.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <Input
                      id={inputId}
                      type={question.kind === 'secret' ? 'password' : 'text'}
                      autoComplete="off"
                      maxLength={4096}
                      value={answer}
                      onChange={(event) => setAnswer(event.target.value)}
                      placeholder={question.placeholder}
                      required
                    />
                  )}
                </label>
                <Button disabled={!answer.trim() || submit.isPending} type="submit">
                  提交授权输入
                </Button>
              </form>
            )}
          </>
        )}
        {(submit.error || cancel.error) && (
          <p role="alert" className="text-sm text-destructive">
            {describeRequestError(submit.error ?? cancel.error).description}
          </p>
        )}
      </DialogFormBody>
      <DialogFormFooter>
        {data?.status === 'succeeded' ? (
          <Button type="button" onClick={onDone}>
            完成
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            disabled={cancel.isPending}
            onClick={() => (finished ? onClose() : cancel.mutate())}
          >
            {finished ? '关闭' : '取消登录'}
          </Button>
        )}
      </DialogFormFooter>
    </>
  )
}

/** 配置 API Key 连接或按提供方指引完成订阅授权。 */
export function BotConnectionForm({ teamId, onClose }: { teamId: string; onClose: () => void }) {
  const id = useId()
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const [authType, setAuthType] = useState<'api_key' | 'oauth'>('api_key')
  const [name, setName] = useState('')
  const [providerId, setProviderId] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [credentialId, setCredentialId] = useState('')
  const [sessionId, setSessionId] = useState<string>()
  const catalog = useQuery(botCatalogOptions(teamId))
  const providers = [
    ...new Set(
      catalog.data?.data.filter((model) => model.authTypes.includes(authType)).map((model) => model.providerId),
    ),
  ]
  const credentials = useQuery({
    queryKey: [...connectionQueryKey, teamId, 'model-keys'],
    queryFn: ({ signal }) =>
      apiClient.listCredentials(teamId, { kind: 'model_api_key', status: 'active', pageSize: 100 }, { signal }),
    enabled: authType === 'api_key',
  })
  const refreshAndClose = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: connectionQueryKey }),
      queryClient.invalidateQueries({ queryKey: botQueryKey }),
    ])
    showToast('模型连接已保存', 'success')
    onClose()
  }
  const mutation = useMutation({
    mutationFn: async () => {
      const input = { name: name.trim(), providerId }
      if (authType === 'oauth') {
        const result = await apiClient.startBotOAuthLogin(teamId, input, writeOptions())
        return result.data.loginSessionId
      }
      await apiClient.createBotConnection(
        teamId,
        {
          ...input,
          ...(credentialId ? { credentialId } : { apiKey }),
        },
        writeOptions(),
      )
      return undefined
    },
    onSuccess: async (loginId) => {
      setApiKey('')
      if (loginId) setSessionId(loginId)
      else await refreshAndClose()
    },
  })
  const canSave =
    name.trim() && providers.includes(providerId) && (authType === 'oauth' || credentialId || apiKey.trim())
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !sessionId && !mutation.isPending) onClose()
      }}
    >
      <DialogContent layout="form" showCloseButton={!sessionId}>
        <DialogFormHeader>
          <DialogTitle>{sessionId ? '订阅登录' : '添加模型连接'}</DialogTitle>
          <DialogDescription>在团队内保存模型连接和认证。</DialogDescription>
        </DialogFormHeader>
        {sessionId ? (
          <LoginStep sessionId={sessionId} onDone={() => void refreshAndClose()} onClose={onClose} />
        ) : (
          <form
            className="flex min-h-0 flex-col"
            onSubmit={(event) => {
              event.preventDefault()
              if (canSave && !mutation.isPending) mutation.mutate()
            }}
          >
            <DialogFormBody className="space-y-4">
              <div className="form-grid">
                <label className="field" htmlFor={`${id}-name`}>
                  <span>连接名称</span>
                  <Input
                    id={`${id}-name`}
                    maxLength={60}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    required
                  />
                </label>
                <label className="field" htmlFor={`${id}-auth`}>
                  <span>连接方式</span>
                  <Select
                    id={`${id}-auth`}
                    value={authType}
                    onChange={(event) => {
                      setAuthType(event.target.value === 'oauth' ? 'oauth' : 'api_key')
                      setProviderId('')
                      setApiKey('')
                    }}
                  >
                    <option value="api_key">API Key</option>
                    <option value="oauth">订阅登录</option>
                  </Select>
                </label>
                <label className="field full" htmlFor={`${id}-provider`}>
                  <span>提供方</span>
                  <Select
                    id={`${id}-provider`}
                    value={providerId}
                    onChange={(event) => setProviderId(event.target.value)}
                    required
                    disabled={catalog.isPending || catalog.isError}
                  >
                    <option value="">请选择提供方</option>
                    {providers.map((provider) => (
                      <option key={provider} value={provider}>
                        {provider}
                      </option>
                    ))}
                  </Select>
                </label>
                {catalog.isSuccess && providers.length === 0 && (
                  <p className="quiet small">执行服务尚未报告此类型的模型目录。</p>
                )}
                {catalog.isError && (
                  <Button type="button" variant="outline" onClick={() => void catalog.refetch()}>
                    重试读取模型目录
                  </Button>
                )}
                {authType === 'api_key' && (
                  <>
                    <label className="field full" htmlFor={`${id}-credential`}>
                      <span>模型密钥</span>
                      <Select
                        id={`${id}-credential`}
                        value={credentialId}
                        onChange={(event) => setCredentialId(event.target.value)}
                      >
                        <option value="">填写新密钥</option>
                        {credentials.data?.data.items.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name}
                          </option>
                        ))}
                      </Select>
                    </label>
                    {credentials.isError && (
                      <Button type="button" variant="outline" onClick={() => void credentials.refetch()}>
                        重试加载已有密钥
                      </Button>
                    )}
                    {!credentialId && (
                      <label className="field full" htmlFor={`${id}-key`}>
                        <span>API Key</span>
                        <Input
                          id={`${id}-key`}
                          type="password"
                          autoComplete="off"
                          maxLength={8192}
                          value={apiKey}
                          onChange={(event) => setApiKey(event.target.value)}
                          required
                        />
                      </label>
                    )}
                  </>
                )}
              </div>
              {mutation.error && (
                <p role="alert" className="text-sm text-destructive">
                  {describeRequestError(mutation.error).description}
                </p>
              )}
            </DialogFormBody>
            <DialogFormFooter>
              <Button variant="outline" type="button" disabled={mutation.isPending} onClick={onClose}>
                取消
              </Button>
              <Button disabled={!canSave || mutation.isPending} type="submit">
                {authType === 'oauth' ? '发起登录' : '保存连接'}
              </Button>
            </DialogFormFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
