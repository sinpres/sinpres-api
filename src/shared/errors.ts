import type { Context } from 'hono'

export function notFound(c: Context, message = 'Resource not found') {
  return c.json({ error: message }, 404)
}

export function badRequest(c: Context, message = 'Bad request') {
  return c.json({ error: message }, 400)
}
