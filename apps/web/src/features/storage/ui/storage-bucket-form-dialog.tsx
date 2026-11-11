import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Button } from '@/shared/ui/controls/button'
import { Checkbox } from '@/shared/ui/controls/checkbox'
import {
  Dialog,
  DialogContent,
  DialogFormBody,
  DialogFormFooter,
  DialogFormHeader,
  DialogTitle,
} from '@/shared/ui/controls/dialog'
import { FormField, FormGrid, FormSection } from '@/shared/ui/controls/form-field'
import { Input } from '@/shared/ui/controls/input'
import { Select } from '@/shared/ui/controls/select'
import { BUCKET_STATUS_LABELS } from '../model/labels'
import type {
  CreateStorageBucketInput,
  StorageBucket,
  StorageBucketStatus,
  UpdateStorageBucketInput,
} from '../model/types'

/** 储存桶表单字段级错误；键名与字段一一对应。 */
interface BucketFieldErrors {
  name?: string
  endpoint?: string
  bucketName?: string
  region?: string
  pathPrefix?: string
  accessKeyId?: string
  secretAccessKey?: string
}

export interface StorageBucketFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 编辑目标；为 null 时是创建模式。 */
  bucket: StorageBucket | null
  isSubmitting: boolean
  /** 服务端返回的可读错误；保留用户输入并就地展示。 */
  errorDescription: string | null
  onCreate: (input: CreateStorageBucketInput) => void
  onUpdate: (bucketId: string, input: UpdateStorageBucketInput) => void
}

/**
 * 校验接入地址：必须是完整 HTTP/HTTPS URL，且不携带凭据、查询参数与片段。
 * @param value 用户输入。
 * @returns 错误说明；合法时返回 null。
 */
function validateEndpoint(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return '请填写接入地址。'
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return '接入地址必须是完整的 HTTP 或 HTTPS URL。'
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return '接入地址只支持 HTTP 或 HTTPS。'
  if (url.username || url.password) return '接入地址不能包含凭据，请改用 Access Key 配置。'
  if (url.search || url.hash) return '接入地址不能包含查询参数或片段。'
  return null
}

/**
 * 校验对象键前缀：允许字母、数字、点、下划线、连字符与斜杠，不允许空段与 . / ..。
 * @param value 用户输入。
 * @returns 错误说明；合法或为空时返回 null。
 */
function validatePathPrefix(value: string): string | null {
  const trimmed = value.trim().replace(/^\/+|\/+$/g, '')
  if (!trimmed) return null
  if (trimmed.length > 255) return '路径前缀长度不能超过 255 个字符。'
  for (const segment of trimmed.split('/')) {
    if (!segment || segment === '.' || segment === '..') return '路径前缀不能包含空段、"." 或 ".."。'
    if (!/^[A-Za-z0-9._-]+$/.test(segment)) {
      return '路径前缀只能包含字母、数字、点、下划线、连字符与斜杠。'
    }
  }
  return null
}

/**
 * 滚动并聚焦首个错误字段，避免在长表单中只看到顶部汇总。
 * @param target 首个错误对应的可聚焦控件。
 */
function focusField(target: HTMLElement | null) {
  target?.scrollIntoView?.({ block: 'center' })
  target?.focus()
}

/**
 * 创建或编辑 S3 兼容储存桶。
 * Secret 只写不读：编辑时留空表示保持原值，页面与请求都不会回填明文凭据。
 * @param props 打开状态、编辑目标、提交状态、服务端错误与回调。
 * @returns 表单弹窗；内置本地桶只允许改名称。
 */
export function StorageBucketFormDialog({
  open,
  onOpenChange,
  bucket,
  isSubmitting,
  errorDescription,
  onCreate,
  onUpdate,
}: StorageBucketFormDialogProps) {
  const isEditing = bucket !== null
  const isBuiltin = bucket?.isBuiltin ?? false
  const [name, setName] = useState('')
  const [endpoint, setEndpoint] = useState('')
  const [bucketName, setBucketName] = useState('')
  const [region, setRegion] = useState('')
  const [pathPrefix, setPathPrefix] = useState('')
  const [accessKeyId, setAccessKeyId] = useState('')
  const [secretAccessKey, setSecretAccessKey] = useState('')
  const [status, setStatus] = useState<StorageBucketStatus>('enabled')
  const [setAsDefault, setSetAsDefault] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<BucketFieldErrors>({})
  const nameRef = useRef<HTMLInputElement>(null)
  const endpointRef = useRef<HTMLInputElement>(null)
  const bucketNameRef = useRef<HTMLInputElement>(null)
  const regionRef = useRef<HTMLInputElement>(null)
  const pathPrefixRef = useRef<HTMLInputElement>(null)
  const accessKeyRef = useRef<HTMLInputElement>(null)
  const secretRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setName(bucket?.name ?? '')
    setEndpoint(bucket?.endpoint ?? '')
    setBucketName(bucket?.bucketName ?? '')
    setRegion(bucket?.region ?? '')
    setPathPrefix(bucket?.pathPrefix ?? '')
    setAccessKeyId('')
    setSecretAccessKey('')
    setStatus(bucket?.status ?? 'enabled')
    setSetAsDefault(false)
    setFieldErrors({})
  }, [open, bucket])

  /**
   * 校验表单；创建时凭据必填，编辑时 Access Key 与 Secret 必须同时留空或同时填写。
   * @returns 字段错误表；为空表示可提交。
   */
  const validate = (): BucketFieldErrors => {
    const errors: BucketFieldErrors = {}
    if (!name.trim()) errors.name = '请填写储存桶名称。'
    else if (name.trim().length > 120) errors.name = '名称长度不能超过 120 个字符。'
    if (!isBuiltin) {
      const endpointError = validateEndpoint(endpoint)
      if (endpointError) errors.endpoint = endpointError
      if (!bucketName.trim()) errors.bucketName = '请填写桶名。'
      else if (!/^[A-Za-z0-9._-]+$/.test(bucketName.trim())) {
        errors.bucketName = '桶名只能包含字母、数字、点、下划线与连字符。'
      }
      if (region.trim() && !/^[A-Za-z0-9-]+$/.test(region.trim())) {
        errors.region = '区域只能包含字母、数字与连字符。'
      }
      const pathPrefixError = validatePathPrefix(pathPrefix)
      if (pathPrefixError) errors.pathPrefix = pathPrefixError
      const hasAccessKey = accessKeyId.trim().length > 0
      const hasSecret = secretAccessKey.length > 0
      if (!isEditing && !hasAccessKey) errors.accessKeyId = '请填写 Access Key ID。'
      if (!isEditing && !hasSecret) errors.secretAccessKey = '请填写 Secret Access Key。'
      if (isEditing && hasAccessKey !== hasSecret) {
        errors.secretAccessKey = '修改访问密钥时必须同时填写 Access Key ID 与 Secret Access Key。'
      }
      if (hasAccessKey && /\s/.test(accessKeyId.trim())) errors.accessKeyId = 'Access Key ID 不能包含空白字符。'
    }
    return errors
  }

  /**
   * 提交表单：按模式拼装创建或更新请求体，并把首个错误滚动到可见位置。
   * @param event 表单提交事件。
   */
  const submit = (event: FormEvent) => {
    event.preventDefault()
    const errors = validate()
    setFieldErrors(errors)
    if (Object.keys(errors).length > 0) {
      const firstTarget = errors.name
        ? nameRef.current
        : errors.endpoint
          ? endpointRef.current
          : errors.bucketName
            ? bucketNameRef.current
            : errors.region
              ? regionRef.current
              : errors.pathPrefix
                ? pathPrefixRef.current
                : errors.accessKeyId
                  ? accessKeyRef.current
                  : secretRef.current
      focusField(firstTarget)
      return
    }
    if (!isEditing) {
      onCreate({
        name: name.trim(),
        kind: 's3',
        endpoint: endpoint.trim(),
        bucketName: bucketName.trim(),
        ...(region.trim() ? { region: region.trim() } : {}),
        pathPrefix: pathPrefix.trim() || null,
        accessKeyId: accessKeyId.trim(),
        secretAccessKey,
        setAsDefault,
      })
      return
    }
    const update: UpdateStorageBucketInput = { version: bucket.version, name: name.trim() }
    if (!isBuiltin) {
      update.endpoint = endpoint.trim()
      update.bucketName = bucketName.trim()
      if (region.trim()) update.region = region.trim()
      update.pathPrefix = pathPrefix.trim() || null
      update.status = status
      if (accessKeyId.trim() && secretAccessKey) {
        update.accessKeyId = accessKeyId.trim()
        update.secretAccessKey = secretAccessKey
      }
    }
    onUpdate(bucket.id, update)
  }

  /**
   * 清除指定字段错误；只在该字段原本有错误时更新状态，避免无谓渲染。
   * @param field 字段错误键。
   */
  const clearFieldError = (field: keyof BucketFieldErrors) => {
    setFieldErrors((current) => (current[field] ? { ...current, [field]: undefined } : current))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent layout="form">
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={submit} noValidate>
          <DialogFormHeader>
            <DialogTitle className="text-xl">{isEditing ? `编辑储存桶「${bucket.name}」` : '新建储存桶'}</DialogTitle>
          </DialogFormHeader>
          <DialogFormBody>
            <div className="space-y-6">
              {errorDescription && (
                <p
                  role="alert"
                  className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                >
                  {errorDescription}
                </p>
              )}
              <FormSection title="基本信息">
                <FormField label="名称" htmlFor="storage-bucket-name" required error={fieldErrors.name}>
                  <Input
                    id="storage-bucket-name"
                    ref={nameRef}
                    value={name}
                    onChange={(event) => {
                      setName(event.target.value)
                      clearFieldError('name')
                    }}
                    aria-invalid={fieldErrors.name ? true : undefined}
                    maxLength={120}
                    autoFocus
                  />
                </FormField>
                {isBuiltin ? (
                  <p className="text-sm text-muted-foreground">
                    内置本地储存桶由部署服务器提供，只允许修改名称；接入参数与状态受保护。
                  </p>
                ) : (
                  <FormGrid>
                    <FormField label="接入地址" htmlFor="storage-bucket-endpoint" required error={fieldErrors.endpoint}>
                      <Input
                        id="storage-bucket-endpoint"
                        ref={endpointRef}
                        value={endpoint}
                        onChange={(event) => {
                          setEndpoint(event.target.value)
                          clearFieldError('endpoint')
                        }}
                        aria-invalid={fieldErrors.endpoint ? true : undefined}
                        placeholder="https://s3.example.com"
                      />
                    </FormField>
                    <FormField
                      label="桶名"
                      htmlFor="storage-bucket-bucket-name"
                      required
                      error={fieldErrors.bucketName}
                    >
                      <Input
                        id="storage-bucket-bucket-name"
                        ref={bucketNameRef}
                        value={bucketName}
                        onChange={(event) => {
                          setBucketName(event.target.value)
                          clearFieldError('bucketName')
                        }}
                        aria-invalid={fieldErrors.bucketName ? true : undefined}
                        placeholder="dev-ops-attachments"
                        maxLength={255}
                      />
                    </FormField>
                  </FormGrid>
                )}
              </FormSection>
              {!isBuiltin && (
                <FormSection title="对象路径">
                  <FormGrid>
                    <FormField
                      label="区域"
                      htmlFor="storage-bucket-region"
                      help="留空时服务端按 us-east-1 处理。"
                      error={fieldErrors.region}
                    >
                      <Input
                        id="storage-bucket-region"
                        ref={regionRef}
                        value={region}
                        onChange={(event) => {
                          setRegion(event.target.value)
                          clearFieldError('region')
                        }}
                        aria-invalid={fieldErrors.region ? true : undefined}
                        placeholder="us-east-1"
                        maxLength={64}
                      />
                    </FormField>
                    <FormField
                      label="路径前缀"
                      htmlFor="storage-bucket-path-prefix"
                      help="用于隔离不同环境的附件，例如 prod/attachments。"
                      error={fieldErrors.pathPrefix}
                    >
                      <Input
                        id="storage-bucket-path-prefix"
                        ref={pathPrefixRef}
                        value={pathPrefix}
                        onChange={(event) => {
                          setPathPrefix(event.target.value)
                          clearFieldError('pathPrefix')
                        }}
                        aria-invalid={fieldErrors.pathPrefix ? true : undefined}
                        maxLength={255}
                      />
                    </FormField>
                  </FormGrid>
                  <FormField
                    label="启用状态"
                    htmlFor="storage-bucket-status"
                    help="停用后历史附件不可下载；仍被附件引用时服务端会拒绝停用。"
                  >
                    <Select
                      id="storage-bucket-status"
                      value={status}
                      onChange={(event) => setStatus(event.target.value === 'disabled' ? 'disabled' : 'enabled')}
                    >
                      <option value="enabled">{BUCKET_STATUS_LABELS.enabled}</option>
                      <option value="disabled">{BUCKET_STATUS_LABELS.disabled}</option>
                    </Select>
                  </FormField>
                </FormSection>
              )}
              {!isBuiltin && (
                <FormSection title="访问密钥">
                  <p className="text-sm text-muted-foreground">
                    密钥只写不读，保存后服务端只返回掩码。
                    {isEditing && bucket.accessKeyHint ? ` 当前 Access Key：${bucket.accessKeyHint}` : ''}
                  </p>
                  <FormGrid>
                    <FormField
                      label="Access Key ID"
                      htmlFor="storage-bucket-access-key"
                      required={!isEditing}
                      help={isEditing ? '留空表示不修改。' : undefined}
                      error={fieldErrors.accessKeyId}
                    >
                      <Input
                        id="storage-bucket-access-key"
                        ref={accessKeyRef}
                        value={accessKeyId}
                        onChange={(event) => {
                          setAccessKeyId(event.target.value)
                          clearFieldError('accessKeyId')
                        }}
                        aria-invalid={fieldErrors.accessKeyId ? true : undefined}
                        autoComplete="off"
                        maxLength={256}
                      />
                    </FormField>
                    <FormField
                      label="Secret Access Key"
                      htmlFor="storage-bucket-secret"
                      required={!isEditing}
                      help={isEditing ? '留空表示不修改。' : undefined}
                      error={fieldErrors.secretAccessKey}
                    >
                      <Input
                        id="storage-bucket-secret"
                        ref={secretRef}
                        type="password"
                        value={secretAccessKey}
                        onChange={(event) => {
                          setSecretAccessKey(event.target.value)
                          clearFieldError('secretAccessKey')
                        }}
                        aria-invalid={fieldErrors.secretAccessKey ? true : undefined}
                        autoComplete="new-password"
                        maxLength={512}
                      />
                    </FormField>
                  </FormGrid>
                </FormSection>
              )}
              {!isEditing && (
                <label className="flex items-center gap-2 text-sm font-medium">
                  <Checkbox checked={setAsDefault} onCheckedChange={(checked) => setSetAsDefault(checked === true)} />
                  创建后设为默认储存桶（需先通过可读写测试）
                </label>
              )}
            </div>
          </DialogFormBody>
          <DialogFormFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
              取消
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? '保存中…' : '保存'}
            </Button>
          </DialogFormFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
