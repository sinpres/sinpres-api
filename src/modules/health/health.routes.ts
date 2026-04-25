import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'

const healthRoute = createRoute({
  method: 'get',
  path: '/health',
  tags: ['Health'],
  responses: {
    200: {
      content: { 'application/json': { schema: z.object({ status: z.string() }) } },
      description: 'API is healthy',
    },
  },
})

export const healthApp = new OpenAPIHono()

healthApp.openapi(healthRoute, (c) => {
  return c.json({ status: 'ok' }, 200)
})

// TEMP diagnostic — REMOVE after debugging Vercel runtime env mismatch.
function maskUrl(url: string | undefined): string | null {
  if (!url) return null
  return url.replace(/:[^@]*@/, ':***@')
}
healthApp.get('/__debug/runtime-env', (c) => {
  return c.json({
    DATABASE_URL: maskUrl(process.env.DATABASE_URL),
    POSTGRES_URL: maskUrl(process.env.POSTGRES_URL),
    POSTGRES_DATABASE: process.env.POSTGRES_DATABASE ?? null,
    POSTGRES_HOST: process.env.POSTGRES_HOST ?? null,
    PGDATABASE: process.env.PGDATABASE ?? null,
  })
})
