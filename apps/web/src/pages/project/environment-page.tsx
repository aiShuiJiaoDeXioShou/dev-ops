import { useParams } from 'react-router'
import { EnvironmentVariables } from '@/features/configuration/public'

/** 项目环境变量页。 */
export function Component() {
  const { projectId = '' } = useParams()
  return <EnvironmentVariables projectId={projectId} />
}

export default Component
