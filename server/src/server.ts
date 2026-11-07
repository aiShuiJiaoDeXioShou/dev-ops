import { buildApp } from './app.js'
import { loadConfig } from './config/env.js'

const config = loadConfig()
const app = buildApp(config)
let closing = false

async function shutdown(signal: string) {
  if (closing) return
  closing = true
  app.log.info({ signal }, 'Shutting down')

  const timeout = setTimeout(() => {
    app.log.error('Shutdown timed out')
    process.exit(1)
  }, 10_000)
  timeout.unref()

  try {
    await app.close()
  } catch (error) {
    app.log.error(error, 'Shutdown failed')
    process.exitCode = 1
  } finally {
    clearTimeout(timeout)
  }
}

process.once('SIGINT', () => { void shutdown('SIGINT') })
process.once('SIGTERM', () => { void shutdown('SIGTERM') })

try {
  await app.listen({ port: config.PORT, host: config.HOST })
} catch (error) {
  app.log.error(error, 'Server failed to start')
  await app.close()
  process.exitCode = 1
}
