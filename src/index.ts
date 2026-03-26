import { app } from './app'
import { env } from './env'
import { serveStatic } from 'hono/bun'

// Static files (images) — Bun only, not available in vitest
app.use('/images/*', serveStatic({ root: './public' }))

console.log(`SINPRES API running on http://localhost:${env.PORT}`)

export default {
  port: env.PORT,
  fetch: app.fetch,
}
