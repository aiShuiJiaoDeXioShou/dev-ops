import { useEffect, useState } from 'react'
import { PrototypeDialog } from '@/prototype/components/prototype-dialog'
import { ProtoButton, ProtoEmpty, ProtoSectionHeading } from '@/prototype/components/proto-controls'
import { ProtoChip } from '@/prototype/components/proto'
import { PrototypeIcon } from '@/prototype/icons/icon'
import { usePrototype } from '@/prototype/data/store'
import { pipelineRuns } from '@/prototype/data/project-detail'
import type { DemoPipelineRun } from '@/prototype/data/project-detail'

/**
 * 渲染原型的流水线列表与独立运行入口。
 * @returns 与 pipelines 结构和类名一致的页面；演示运行不会修改事项状态。
 */
export function PipelinesPage() {
  const { currentProject, currentRole, showToast } = usePrototype()
  const [runs, setRuns] = useState<DemoPipelineRun[]>(() =>
    pipelineRuns.filter((run) => run.projectId === currentProject.id),
  )
  const [selected, setSelected] = useState<DemoPipelineRun | null>(null)

  useEffect(() => {
    setRuns(pipelineRuns.filter((run) => run.projectId === currentProject.id))
  }, [currentProject.id])

  const trigger = () => {
    if (currentRole === '浏览者') return
    setRuns((current) => [
      {
        id: `run-${Date.now()}`,
        projectId: currentProject.id,
        workflow: 'web-build',
        branch: 'feat/error-handling',
        status: '运行中',
        triggeredBy: '原型手动触发',
        time: new Date().toLocaleString('zh-CN'),
        logs: ['checkout b8d304f', 'install dependencies', 'build web', 'waiting for runner…'],
      },
      ...current,
    ])
    showToast('流水线为独立运维操作；未改变需求提测状态')
  }

  const complete = (runId: string) => {
    setRuns((current) =>
      current.map((run) =>
        run.id === runId
          ? { ...run, status: '成功', logs: [...run.logs, 'build completed', 'upload artifact: web-0.9.3'] }
          : run,
      ),
    )
    showToast('演示运行已完成；业务状态未自动推进')
  }

  return (
    <>
      <ProtoSectionHeading
        title="流水线"
        actions={
          <ProtoButton variant="primary" disabled={currentRole === '浏览者'} onClick={trigger}>
            <PrototypeIcon name="arrow" />
            运行流水线
          </ProtoButton>
        }
      />
      <p className="small muted">
        流水线由研发自行配置；平台只收集和展示结果。提测不会触发、等待或重试流水线，运行结果也不会自动推进事项状态。
      </p>
      {runs.length === 0 ? (
        <ProtoEmpty
          icon="terminal"
          title="还没有流水线运行"
          description="通过项目工具发起演示运行，结果同时回到会话。"
        />
      ) : (
        <div className="work-gap">
          {runs.map((run) => (
            <button key={run.id} type="button" className="work-task-row" onClick={() => setSelected(run)}>
              <span>
                <strong>
                  {run.workflow} · {run.branch}
                </strong>
                <small>
                  {run.triggeredBy} · {run.time}
                </small>
              </span>
              {run.status === '运行中' ? (
                <span
                  className="row"
                  onClick={(event) => {
                    event.stopPropagation()
                    complete(run.id)
                  }}
                >
                  <ProtoChip tone="warning">运行中</ProtoChip>
                  <span className="text-btn">演示完成</span>
                </span>
              ) : (
                <ProtoChip tone={run.status === '成功' ? 'success' : undefined}>{run.status}</ProtoChip>
              )}
            </button>
          ))}
        </div>
      )}
      <PrototypeDialog
        open={selected !== null}
        title={selected ? `${selected.workflow} · #${selected.id}` : '流水线运行'}
        onClose={() => setSelected(null)}
      >
        {selected && (
          <>
            <div className="row">
              <ProtoChip>{selected.status}</ProtoChip>
              <span className="small quiet">
                {selected.branch} · {selected.triggeredBy} · {selected.time}
              </span>
            </div>
            <pre className="code">
              <code>{selected.logs.join('\n')}</code>
            </pre>
            <p className="small muted">流水线结论不会自动修改 PRD 或 Bug 状态；请通过独立业务动作维护。</p>
            <div className="form-actions">
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
