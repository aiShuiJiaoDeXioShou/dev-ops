import { useState } from 'react'
import { PrototypeDialog } from '@/prototype/components/prototype-dialog'
import { ProtoButton, ProtoEmpty, ProtoSectionHeading } from '@/prototype/components/proto-controls'
import { PrototypeIcon } from '@/prototype/icons/icon'
import { usePrototype } from '@/prototype/data/store'
import { serviceDeliveries } from '@/prototype/data/project-detail'
import type { DemoServiceDelivery } from '@/prototype/data/project-detail'

/**
 * 渲染原型的服务交付页，构建产物与环境版本分列展示。
 * @returns 与 artifactsPage 结构和类名一致的页面。
 */
export function ArtifactsPage() {
  const { currentProject, showToast } = usePrototype()
  const services = serviceDeliveries.filter((item) => item.projectId === currentProject.id)
  const [artifact, setArtifact] = useState<DemoServiceDelivery | null>(null)
  const [environment, setEnvironment] = useState<DemoServiceDelivery | null>(null)

  return (
    <>
      <ProtoSectionHeading title="服务交付" />
      {services.length === 0 ? (
        <ProtoEmpty
          icon="box"
          title="还没有服务与产物"
          description="项目尚未收到构建或环境版本信息。"
          action={<ProtoButton onClick={() => showToast('项目设置入口在项目工作区')}>查看项目设置</ProtoButton>}
        />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>服务</th>
                <th>最新构建产物</th>
                <th>测试环境运行版本</th>
                <th>生产环境运行版本</th>
              </tr>
            </thead>
            <tbody>
              {services.map((service) => (
                <tr key={`${service.projectId}-${service.service}`}>
                  <td>
                    <span className="row">
                      <PrototypeIcon name="box" />
                      {service.service}
                    </span>
                  </td>
                  <td>
                    {service.artifact}
                    <br />
                    <button type="button" className="text-btn" onClick={() => setArtifact(service)}>
                      查看产物
                    </button>
                  </td>
                  <td>
                    {service.testVersion}
                    <br />
                    <button type="button" className="text-btn" onClick={() => setEnvironment(service)}>
                      查看环境信息
                    </button>
                  </td>
                  <td>{service.productionVersion}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="small muted">构建完成不等于已部署；最新产物与测试、生产环境运行版本分别维护。</p>

      <PrototypeDialog
        open={artifact !== null}
        title={artifact ? `${artifact.service} · 最新构建产物` : '构建产物'}
        onClose={() => setArtifact(null)}
      >
        {artifact && (
          <>
            <dl className="work-properties">
              <dt>产物版本</dt>
              <dd>{artifact.artifact}</dd>
              <dt>生成时间</dt>
              <dd>{artifact.artifactTime}</dd>
              <dt>服务</dt>
              <dd>{artifact.service}</dd>
            </dl>
            <div className="form-actions">
              <ProtoButton onClick={() => showToast('原型不下载真实产物')}>下载（演示）</ProtoButton>
              <ProtoButton variant="primary" onClick={() => setArtifact(null)}>
                关闭
              </ProtoButton>
            </div>
          </>
        )}
      </PrototypeDialog>

      <PrototypeDialog
        open={environment !== null}
        title={environment ? `${environment.service} · 环境版本` : '环境版本'}
        onClose={() => setEnvironment(null)}
      >
        {environment && (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>环境</th>
                    <th>运行版本</th>
                    <th>健康</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>测试环境</td>
                    <td>{environment.testVersion}</td>
                    <td>{environment.health}</td>
                  </tr>
                  <tr>
                    <td>生产环境</td>
                    <td>{environment.productionVersion}</td>
                    <td>{environment.health}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="small muted">环境版本来源仍待正式接入；该值与最新构建产物分别维护。</p>
            <div className="form-actions">
              <ProtoButton variant="primary" onClick={() => setEnvironment(null)}>
                关闭
              </ProtoButton>
            </div>
          </>
        )}
      </PrototypeDialog>
    </>
  )
}
