import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter } from 'react-router'
import { createAppRoutes } from '@/app/router/routes'
import './shared/styles/index.css'
import App from './app/providers/application.tsx'

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('未找到应用挂载节点')

// 路由初始化会订阅浏览器历史记录，须在 React 严格模式的重复渲染之外执行。
const router = createBrowserRouter(createAppRoutes())

createRoot(rootElement).render(
  <StrictMode>
    <App router={router} />
  </StrictMode>,
)