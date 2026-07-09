import { eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { app } from '../src/app'
import { env } from '../src/env'
import { db } from '../src/db/client'
import { adminUsers } from '../src/db/schema/public'
import { hashPassword } from '../src/shared/password'
import { setLoginRateLimiterForTests } from '../src/shared/login-rate-limit'

// One shared hit map; caps differ per bucket by identifier prefix, mirroring the
// real config (account 5 / ip 20). Tests inject their own small caps.
function createLoginMemoryLimiter(accountCap: number, ipCap: number) {
  const hits = new Map<string, number>()
  const identifiers: string[] = []

  return {
    identifiers,
    limiter: {
      async limit(identifier: string) {
        identifiers.push(identifier)
        const count = (hits.get(identifier) ?? 0) + 1
        hits.set(identifier, count)
        const cap = identifier.startsWith('ip:') ? ipCap : accountCap
        return {
          success: count <= cap,
          limit: cap,
          remaining: Math.max(cap - count, 0),
          reset: Date.now() + 900_000,
        }
      },
    },
  }
}

const LOGIN_EMAIL = 'login-test@sinpres.local'
const LOGIN_PASSWORD = 'correct-horse-battery-staple'
const VALID_SECRET = env.ADMIN_API_SECRET ?? ''

function loginRequest(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return app.request('/admin/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

let adminId: number

beforeAll(async () => {
  await db.delete(adminUsers).where(eq(adminUsers.email, LOGIN_EMAIL))
  const passwordHash = await hashPassword(LOGIN_PASSWORD)
  const [row] = await db
    .insert(adminUsers)
    .values({ email: LOGIN_EMAIL, passwordHash })
    .returning({ id: adminUsers.id })
  adminId = row.id
})

afterAll(async () => {
  await db.delete(adminUsers).where(eq(adminUsers.id, adminId))
})

beforeEach(() => {
  // Generous default so the credential tests never trip a bucket; the throttle
  // tests re-inject their own small caps.
  setLoginRateLimiterForTests(createLoginMemoryLimiter(100, 100).limiter)
})

afterEach(() => {
  setLoginRateLimiterForTests(null)
})

describe('Admin login', () => {
  it('sem header Authorization → 401 (não chega na verificação de credenciais)', async () => {
    const res = await loginRequest({ email: LOGIN_EMAIL, password: LOGIN_PASSWORD })

    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe('Unauthorized')
  })

  it('Bearer inválido → 401', async () => {
    const res = await loginRequest(
      { email: LOGIN_EMAIL, password: LOGIN_PASSWORD },
      { authorization: 'Bearer wrong-secret-value-that-is-at-least-32-chars' },
    )

    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe('Unauthorized')
  })

  it('Bearer válido + senha errada → 401 genérico', async () => {
    const res = await loginRequest(
      { email: LOGIN_EMAIL, password: 'wrong-password' },
      { authorization: `Bearer ${VALID_SECRET}` },
    )

    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe('Credenciais inválidas')
  })

  it('Bearer válido + credenciais corretas → 200 com user', async () => {
    const res = await loginRequest(
      { email: LOGIN_EMAIL, password: LOGIN_PASSWORD },
      { authorization: `Bearer ${VALID_SECRET}` },
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.user.id).toBe(adminId)
    expect(body.user.email).toBe(LOGIN_EMAIL)
  })

  it('throttle por IP real: e-mails diferentes do mesmo x-forwarded-client-ip estouram o bucket ip', async () => {
    const memory = createLoginMemoryLimiter(100, 3)
    setLoginRateLimiterForTests(memory.limiter)

    const ip = '203.0.113.50'
    const statuses: number[] = []
    for (let i = 0; i < 4; i++) {
      const res = await loginRequest(
        { email: `spray-${i}@sinpres.local`, password: 'nope' },
        { authorization: `Bearer ${VALID_SECRET}`, 'x-forwarded-client-ip': ip },
      )
      statuses.push(res.status)
    }

    // Every email is fresh, so the account bucket never denies; the ip bucket
    // (cap 3) is what caps the spraying — anti-spraying property.
    expect(statuses.slice(0, 3)).toEqual([401, 401, 401])
    expect(statuses[3]).toBe(429)
    expect(memory.identifiers.some((id) => id.startsWith('ip:'))).toBe(true)
    expect(memory.identifiers).toContain(`ip:${ip}`)
  })

  it('throttle por conta: mesmo e-mail estoura o bucket account; outro e-mail de IP novo passa', async () => {
    const memory = createLoginMemoryLimiter(2, 100)
    setLoginRateLimiterForTests(memory.limiter)

    const ip = '198.51.100.7'
    const attempt = (email: string, srcIp: string) =>
      loginRequest(
        { email, password: 'nope' },
        { authorization: `Bearer ${VALID_SECRET}`, 'x-forwarded-client-ip': srcIp },
      )

    const a1 = await attempt(LOGIN_EMAIL, ip)
    const a2 = await attempt(LOGIN_EMAIL, ip)
    const a3 = await attempt(LOGIN_EMAIL, ip)

    expect(a1.status).toBe(401)
    expect(a2.status).toBe(401)
    expect(a3.status).toBe(429)

    // Different account from a fresh IP is unaffected by the account bucket above.
    const other = await attempt('other-account@sinpres.local', '198.51.100.99')
    expect(other.status).toBe(401)
    expect(memory.identifiers).toContain(`account:${LOGIN_EMAIL}`)
  })

  it('throttle falha aberto: erro no limiter não bloqueia login legítimo', async () => {
    setLoginRateLimiterForTests({ async limit() { throw new Error('redis down') } })

    const res = await loginRequest(
      { email: LOGIN_EMAIL, password: LOGIN_PASSWORD },
      { authorization: `Bearer ${VALID_SECRET}` },
    )

    expect(res.status).toBe(200)
  })
})
