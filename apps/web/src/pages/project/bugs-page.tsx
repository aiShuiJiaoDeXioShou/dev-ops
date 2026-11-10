import { useParams } from 'react-router'
import { BugList } from '@/features/bugs/public'

/** 项目 Bug 页。 */
export function Component() {
  const { projectId = '' } = useParams()
  return <BugList projectId={projectId} />
}

export default Component
