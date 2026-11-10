import { useState } from 'react'
import { PrototypeIcon } from '@/prototype/icons/icon'
import { ProtoButton, ProtoEmpty, ProtoSectionHeading } from '@/prototype/components/proto-controls'
import { usePrototype } from '@/prototype/data/store'
import { codeFiles, pullRequests } from '@/prototype/data/project-detail'

const branches = ['main', 'feat/error-handling']

/**
 * 渲染原型的只读代码页：分支条、文件树与示例文件内容。
 * @returns 与 codePage 结构和类名一致的代码视图；不读取远端仓库。
 */
export function CodePage() {
  const { currentProject, showToast } = usePrototype()
  const [branch, setBranch] = useState('main')
  const [filePath, setFilePath] = useState('README.md')
  const file = codeFiles.find((item) => item.path === filePath) ?? codeFiles[0]
  const content = file ? (file.content[branch] ?? file.content.main ?? '') : ''
  const pendingPrs = pullRequests.filter((pr) => pr.projectId === currentProject.id && pr.status === '待审核').length

  if (currentProject.repo === '尚未关联仓库') {
    return (
      <ProtoEmpty
        icon="repo"
        title="尚未关联仓库"
        description="V0.1 允许先创建项目，再在项目设置中关联已授权仓库；代码引用只读展示远端状态。"
        action={
          <ProtoButton onClick={() => showToast('项目设置入口在项目工作区右上角；关联仓库只保存本地演示数据')}>
            查看关联设置
          </ProtoButton>
        }
      />
    )
  }

  if (!file) {
    return (
      <ProtoEmpty
        icon="repo"
        title="等待代码平台接入"
        description="关联关系已保存，原型中还没有这个仓库的文件数据。"
        action={<ProtoButton>查看关联设置</ProtoButton>}
      />
    )
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(content)
      showToast('文件内容已复制')
    } catch {
      showToast('浏览器拒绝剪贴板权限，请手动选择内容')
    }
  }

  const download = () => {
    const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = filePath.split('/').at(-1) ?? 'file.txt'
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  return (
    <>
      <div className="git-strip">
        <PrototypeIcon name="branch" />
        <select aria-label="代码分支" value={branch} onChange={(event) => setBranch(event.target.value)}>
          {branches.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
        <span className="divider" />
        <PrototypeIcon name="commit" />
        <button type="button" className="text-btn" onClick={() => showToast('原型未连接代码平台')}>
          {branch === 'main' ? 'a7c92e1' : 'b8d304f'}
        </button>
        <span className="commit-message">{branch === 'main' ? '完善成员权限校验' : '统一错误响应结构'}</span>
        <span className="git-time quiet">20 分钟前</span>
        <span className="spacer" />
        <button type="button" className="text-btn row" onClick={() => showToast('原型未连接代码平台')}>
          <PrototypeIcon name="pr" />
          {pendingPrs} 个待审 PR
        </button>
      </div>
      <ProtoSectionHeading
        title="代码"
        actions={
          <>
            <span className="badge">只读</span>
            <span className="spacer" />
            <span className="small quiet">
              {currentProject.provider} · {branch}
            </span>
          </>
        }
      />
      <div className="file-browser">
        <nav className="file-tree" aria-label="文件目录">
          {codeFiles.map((item) => (
            <button
              key={item.path}
              type="button"
              className={`file ${filePath === item.path ? 'active' : ''}`}
              onClick={() => setFilePath(item.path)}
            >
              <PrototypeIcon name="file" />
              {item.path}
            </button>
          ))}
        </nav>
        <section style={{ minWidth: 0 }}>
          <div className="file-head">
            <span>{filePath}</span>
            <span className="row">
              <button type="button" className="text-btn" onClick={copy}>
                复制内容
              </button>
              <button type="button" className="text-btn" onClick={download}>
                下载文件
              </button>
            </span>
          </div>
          <pre className="code">
            <code>{content}</code>
          </pre>
        </section>
      </div>
    </>
  )
}
