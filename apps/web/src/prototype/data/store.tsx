import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createInitialData } from './seed'
import type { DemoItem, DemoProject, DemoTeam, PrototypeActions, PrototypeData, TeamRole } from './types'

const STORAGE_KEY = 'dev-ops-prototype:v1'

interface PrototypeContextValue extends PrototypeActions {
  data: PrototypeData
  currentTeam: DemoTeam
  currentProject: DemoProject
  currentRole: TeamRole
  teamProjects: DemoProject[]
  projectItems: DemoItem[]
  persistenceWarning: string
}

const PrototypeContext = createContext<PrototypeContextValue | null>(null)

/**
 * 校验浏览器中保存的演示数据，避免旧版本结构污染页面。
 * @param value 从 localStorage 解析出的未知值。
 * @returns 结构可识别时返回演示数据，否则返回 null。
 */
function readStoredData(value: unknown): PrototypeData | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<PrototypeData>
  if (candidate.version !== 1) return null
  if (!Array.isArray(candidate.teams) || !Array.isArray(candidate.projects) || !Array.isArray(candidate.items))
    return null
  if (candidate.teams.length === 0 || candidate.projects.length === 0) return null
  return candidate as PrototypeData
}

/**
 * 从本地存储加载演示数据；不可用时退回初始数据并给出提示。
 * @returns 初始状态与读取警告。
 */
function loadInitialState(): { data: PrototypeData; warning: string } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { data: createInitialData(), warning: '' }
    const parsed = readStoredData(JSON.parse(raw))
    if (!parsed) return { data: createInitialData(), warning: '演示数据格式已更新，已加载初始示例。' }
    return { data: parsed, warning: '' }
  } catch {
    return { data: createInitialData(), warning: '无法读取本地演示数据，已加载初始示例。' }
  }
}

/**
 * 提供原型共享状态、导航上下文与操作。
 * @param props.children 原型页面树。
 * @returns 可读取团队、项目、事项并执行演示操作的数据上下文。
 */
export function PrototypeProvider({ children }: { children: ReactNode }) {
  const [initial] = useState(loadInitialState)
  const [data, setData] = useState(initial.data)
  const [persistenceWarning, setPersistenceWarning] = useState(initial.warning)
  const [toast, setToast] = useState('')
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    } catch {
      setPersistenceWarning('本地存储不可用，本次修改仅在当前页面保留。')
    }
  }, [data])

  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current)
    },
    [],
  )

  const showToast = useCallback((message: string) => {
    setToast(message)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), 3200)
  }, [])

  const setCurrentTeam = useCallback((teamId: string) => {
    setData((current) => {
      if (!current.teams.some((team) => team.id === teamId)) return current
      const firstProject = current.projects.find((project) => project.teamId === teamId)
      return { ...current, currentTeamId: teamId, currentProjectId: firstProject?.id ?? current.currentProjectId }
    })
  }, [])

  const setCurrentProject = useCallback((projectId: string) => {
    setData((current) =>
      current.projects.some((project) => project.id === projectId)
        ? { ...current, currentProjectId: projectId }
        : current,
    )
  }, [])

  const setCurrentRole = useCallback((role: TeamRole) => {
    setData((current) => ({ ...current, currentRole: role }))
  }, [])

  const addItem = useCallback((item: DemoItem) => {
    setData((current) => ({ ...current, items: [item, ...current.items] }))
  }, [])

  const updateItem = useCallback((itemId: string, patch: Partial<DemoItem>) => {
    setData((current) => ({
      ...current,
      items: current.items.map((item) => (item.id === itemId ? { ...item, ...patch } : item)),
    }))
  }, [])

  const updateProject = useCallback((projectId: string, patch: Partial<DemoProject>) => {
    setData((current) => ({
      ...current,
      projects: current.projects.map((project) => (project.id === projectId ? { ...project, ...patch } : project)),
    }))
  }, [])

  const updateTeam = useCallback((teamId: string, patch: Partial<DemoTeam>) => {
    setData((current) => ({
      ...current,
      teams: current.teams.map((team) => (team.id === teamId ? { ...team, ...patch } : team)),
    }))
  }, [])

  const addProject = useCallback((project: DemoProject) => {
    setData((current) => ({ ...current, projects: [...current.projects, project], currentProjectId: project.id }))
  }, [])

  const addComment = useCallback((itemId: string, comment: DemoItem['comments'][number]) => {
    setData((current) => ({
      ...current,
      items: current.items.map((item) =>
        item.id === itemId ? { ...item, comments: [...item.comments, comment] } : item,
      ),
    }))
  }, [])

  const resetData = useCallback(() => {
    setData(createInitialData())
    setPersistenceWarning('')
    showToast('演示数据已重置')
  }, [showToast])

  const value = useMemo<PrototypeContextValue>(() => {
    const currentTeam = data.teams.find((team) => team.id === data.currentTeamId) ?? data.teams[0]
    if (!currentTeam) throw new Error('原型数据缺少团队')
    const teamProjects = data.projects.filter((project) => project.teamId === currentTeam.id)
    const currentProject =
      data.projects.find((project) => project.id === data.currentProjectId && project.teamId === currentTeam.id) ??
      teamProjects[0] ??
      data.projects[0]
    if (!currentProject) throw new Error('原型数据缺少项目')
    return {
      data,
      currentTeam,
      currentProject,
      currentRole: data.currentRole,
      teamProjects,
      projectItems: data.items.filter((item) => item.projectId === currentProject.id),
      persistenceWarning,
      setCurrentTeam,
      setCurrentProject,
      setCurrentRole,
      addItem,
      updateItem,
      updateProject,
      addProject,
      updateTeam,
      addComment,
      resetData,
      showToast,
    }
  }, [
    data,
    persistenceWarning,
    setCurrentTeam,
    setCurrentProject,
    setCurrentRole,
    addItem,
    updateItem,
    updateProject,
    addProject,
    updateTeam,
    addComment,
    resetData,
    showToast,
  ])

  return (
    <PrototypeContext.Provider value={value}>
      {children}
      {toast && (
        <div
          role="status"
          className="fixed bottom-7 left-1/2 z-[60] max-w-[80vw] -translate-x-1/2 rounded-xl bg-foreground px-5 py-3 text-sm text-background shadow-xl"
        >
          {toast}
        </div>
      )}
    </PrototypeContext.Provider>
  )
}

/**
 * 读取原型共享状态与操作。
 * @returns 当前团队、项目、演示数据与操作函数。
 * @throws 在 PrototypeProvider 之外调用时抛出错误。
 */
export function usePrototype() {
  const context = useContext(PrototypeContext)
  if (!context) throw new Error('usePrototype 必须在 PrototypeProvider 内使用')
  return context
}
