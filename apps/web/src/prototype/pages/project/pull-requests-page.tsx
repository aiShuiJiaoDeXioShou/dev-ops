import { useState } from 'react'
import { PrototypeDialog } from '@/prototype/components/prototype-dialog'
import { ProtoButton, ProtoEmpty, ProtoSectionHeading, ProtoSearch } from '@/prototype/components/proto-controls'
import { ProtoStatus } from '@/prototype/components/proto'
import { usePrototype } from '@/prototype/data/store'
import { pullRequests } from '@/prototype/data/project-detail'
import type { DemoPullRequest } from '@/prototype/data/project-detail'

const prFilters = ['全部', '待审核', '草稿', '已合并'] as const

/**
 * 渲染原型的 PR 列表与只读详情，来源状态与业务状态分别展示。
 * @returns 与 prPage 结构和类名一致的 PR 页；不请求代码平台。
 */
export function PullRequestsPage() {
  const { currentProject, showToast } = usePrototype()
  const [filter, setFilter] = useState<(typeof prFilters)[number]>('全部')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<DemoPullRequest | null>(null)
  const all = pullRequests.filter((pr) => pr.projectId === currentProject.id)
  const records = all.filter(
    (pr) =>
      (filter === '全部' || pr.status === filter) &&
      `${pr.id} ${pr.title} ${pr.author}`.toLowerCase().includes(query.toLowerCase()),
  )

  return (
    <>
      <ProtoSectionHeading title="Pull Requests" count={all.length} />
      <div className="filters">
        <select
          className="btn"
          aria-label="PR 状态"
          value={filter}
          onChange={(event) => setFilter(event.target.value as (typeof prFilters)[number])}
        >
          {prFilters.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
        <ProtoSearch label="搜索 PR" placeholder="搜索编号、标题或作者" value={query} onChange={setQuery} />
      </div>
      {records.length === 0 ? (
        <ProtoEmpty
          icon="pr"
          title={all.length ? '没有匹配的 PR' : '还没有关联 PR'}
          description={all.length ? '调整状态或关键词后重试。' : '关联代码平台的 PR 后在这里查看。'}
        />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>标题</th>
                <th>作者</th>
                <th>远端状态</th>
                <th>目标分支</th>
              </tr>
            </thead>
            <tbody>
              {records.map((pr) => (
                <tr key={pr.id}>
                  <td>
                    <button type="button" className="item-title" onClick={() => setSelected(pr)}>
                      <span className="item-id">#{pr.id}</span>
                      {pr.title}
                    </button>
                  </td>
                  <td>{pr.author}</td>
                  <td>
                    <ProtoStatus status={pr.status} />
                  </td>
                  <td>{pr.targetBranch}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <PrototypeDialog
        open={selected !== null}
        title={selected ? `PR #${selected.id} · ${selected.title}` : 'PR'}
        onClose={() => setSelected(null)}
      >
        {selected && (
          <>
            <div className="row">
              <ProtoStatus status={selected.status} />
              <span className="badge">{currentProject.provider}</span>
              <span className="spacer" />
              <span className="small quiet">
                {selected.sourceBranch} → {selected.targetBranch}
              </span>
            </div>
            <div className="info-box">PR 为只读示例；合并不会自动将需求标记为已测试或已发布。</div>
            <pre className="code">
              <code>{selected.diff.join('\n')}</code>
            </pre>
            <p className="small muted">关联事项：{selected.linkedItems.join('、') || '无'}</p>
            <div className="form-actions">
              <ProtoButton onClick={() => showToast('原型未连接代码平台')}>在原平台查看</ProtoButton>
              <ProtoButton variant="primary" onClick={() => setSelected(null)}>
                关闭
              </ProtoButton>
            </div>
          </>
        )}
      </PrototypeDialog>
    </>
  )
}
