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
