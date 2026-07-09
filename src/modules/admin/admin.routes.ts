import { OpenAPIHono, createRoute } from '@hono/zod-openapi'
import { z } from 'zod'
import { timingSafeEqual } from 'node:crypto'
import { createMiddleware } from 'hono/factory'
import { env } from '../../env'
import { verifyPassword, dummyVerify } from '../../shared/password'
import { checkLoginRateLimit } from '../../shared/login-rate-limit'
import { getSecureClientIp } from '../../shared/rate-limit'
import { createClient, findAdminByEmail, listClients, revokeClient } from './admin.service'
import {
  ClientSchema,
  ClientsListSchema,
  CreateClientBodySchema,
  CreateClientResponseSchema,
  ErrorSchema,
  LoginBodySchema,
  LoginResponseSchema,
  RateLimitErrorSchema,
} from './admin.schema'

export const adminApp = new OpenAPIHono()

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

// Service-to-service guard: the web BFF presents ADMIN_API_SECRET as a Bearer
// token from its server side. Key management AND login both sit behind this —
// login is no longer a public endpoint. The browser reaches it only through the
// authenticated BFF, which forwards the real client IP via x-forwarded-client-ip.
const requireAdminSecret = createMiddleware(async (c, next) => {
  const secret = env.ADMIN_API_SECRET
  const header = c.req.header('authorization')
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : ''
  if (!secret || !token || !safeEqual(token, secret)) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  await next()
})

adminApp.use('/admin/login', requireAdminSecret)
adminApp.use('/admin/clients', requireAdminSecret)
adminApp.use('/admin/clients/*', requireAdminSecret)

const loginRoute = createRoute({
  method: 'post',
  path: '/admin/login',
  tags: ['Admin'],
  security: [{ AdminBearer: [] }],
  summary: 'Login administrativo',
  description: 'Valida as credenciais de um operador interno. Não emite token — a sessão é assinada pelo painel web.',
  request: {
    body: { content: { 'application/json': { schema: LoginBodySchema } }, required: true },
  },
  responses: {
    200: { content: { 'application/json': { schema: LoginResponseSchema } }, description: 'Autenticado' },
    401: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Credenciais inválidas' },
    429: { content: { 'application/json': { schema: RateLimitErrorSchema } }, description: 'Muitas tentativas' },
  },
})

adminApp.openapi(loginRoute, async (c) => {
  const { email, password } = c.req.valid('json')
  const normalizedEmail = email.trim().toLowerCase()

  // Real client IP: trusted from x-forwarded-client-ip only because the Bearer
  // above authenticates the BFF that sets it; otherwise the server IP fallback.
  const forwardedIp = c.req.header('x-forwarded-client-ip')?.trim()
  const realIp = forwardedIp || getSecureClientIp(c)

  const rate = await checkLoginRateLimit(normalizedEmail, realIp)
  if (!rate.ok) {
    c.header('Retry-After', String(rate.retryAfter))
    return c.json(
      { error: 'Muitas tentativas. Tente novamente em alguns minutos.', retry_after: rate.retryAfter },
      429,
    )
  }

  const admin = await findAdminByEmail(normalizedEmail)
  // Always run a verify (dummy hash when the account is absent) so response
  // timing does not reveal whether the email exists.
  const passwordOk = admin
    ? await verifyPassword(admin.passwordHash, password)
    : await dummyVerify(password)

  if (!admin || !passwordOk) {
    return c.json({ error: 'Credenciais inválidas' }, 401)
  }

  return c.json({ user: { id: admin.id, email: admin.email } }, 200)
})

const listClientsRoute = createRoute({
  method: 'get',
  path: '/admin/clients',
  tags: ['Admin'],
  security: [{ AdminBearer: [] }],
  summary: 'Listar chaves de integração',
  responses: {
    200: { content: { 'application/json': { schema: ClientsListSchema } }, description: 'Lista de chaves' },
    401: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Não autorizado' },
  },
})

adminApp.openapi(listClientsRoute, async (c) => {
  const data = await listClients()
  return c.json({ data }, 200)
})

const createClientRoute = createRoute({
  method: 'post',
  path: '/admin/clients',
  tags: ['Admin'],
  security: [{ AdminBearer: [] }],
  summary: 'Criar chave de integração',
  description: 'Gera uma chave nova. O valor bruto (`apiKey`) é retornado apenas nesta resposta e não pode ser recuperado depois.',
  request: {
    body: { content: { 'application/json': { schema: CreateClientBodySchema } }, required: true },
  },
  responses: {
    201: { content: { 'application/json': { schema: CreateClientResponseSchema } }, description: 'Chave criada' },
    401: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Não autorizado' },
  },
})

adminApp.openapi(createClientRoute, async (c) => {
  const body = c.req.valid('json')
  const result = await createClient({
    name: body.name,
    scopes: body.scopes,
    rateLimitPerUser: body.rateLimitPerUser,
    rateLimitGlobal: body.rateLimitGlobal ?? null,
  })
  return c.json(result, 201)
})

const revokeClientRoute = createRoute({
  method: 'post',
  path: '/admin/clients/{id}/revoke',
  tags: ['Admin'],
  security: [{ AdminBearer: [] }],
  summary: 'Revogar chave de integração',
  request: {
    params: z.object({ id: z.coerce.number().int().positive() }),
  },
  responses: {
    200: { content: { 'application/json': { schema: z.object({ data: ClientSchema }) } }, description: 'Chave revogada' },
    401: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Não autorizado' },
    404: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Chave não encontrada' },
  },
})

adminApp.openapi(revokeClientRoute, async (c) => {
  const { id } = c.req.valid('param')
  const client = await revokeClient(id)
  if (!client) return c.json({ error: 'Chave não encontrada' }, 404)
  return c.json({ data: client }, 200)
})
