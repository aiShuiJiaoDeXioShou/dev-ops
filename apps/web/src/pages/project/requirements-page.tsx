import { useParams } from 'react-router'
import { RequirementList } from '@/features/requirements/public'

/** 项目需求页。 */
export function Component() {
  const { projectId = '' } = useParams()
  return <RequirementList projectId={projectId} />
}

export default Component
