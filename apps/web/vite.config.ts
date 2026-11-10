import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, loadEnv } from 'vite'
import { fileURLToPath } from 'node:url'

export default defineConfig(({ mode }) => {
  // 读取 .env（供开发与预览共享），同时保留 shell 环境变量优先级。
  const fileEnv = loadEnv(mode, process.cwd(), '')
  const apiTarget = process.env.DEV_OPS_API_TARGET ?? fileEnv.DEV_OPS_API_TARGET ?? 'http://127.0.0.1:3001'

  return {
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      proxy: {
        '/api': apiTarget,
      },
    },
    preview: {
      proxy: {
        '/api': apiTarget,
      },
    },
    plugins: [tailwindcss(), react(), babel({ presets: [reactCompilerPreset()] })],
  }
})
