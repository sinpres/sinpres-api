import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'
import type { Context } from 'hono'
import { createMiddleware } from 'hono/factory'
import { env } from '../env'

const PUBLIC_RATE_LIMIT = 100
const PUBLIC_RATE_WINDOW = '1 m'
const PUBLIC_RATE_LIMIT_PREFIX = 'rl:public'

type RateLimitResult = {
  success: boolean
  limit: number
  remaining: number
  reset: number
  pending?: Promise<unknown>
}

type RateLimiter = {
  limit: (identifier: string) => Promise<RateLimitResult>
}

let limiter: RateLimiter | null | undefined
let warnedMissingRedis = false
let testLimiter: RateLimiter | null | undefined

export function getClientId(c: Context) {
  const runtimeEnv = c.env as { ip?: string } | undefined
  const connectionIp = (
    c.req.header('cf-connecting-ip')
    ?? c.req.header('x-real-ip')
    ?? runtimeEnv?.ip
    ?? 'unknown'
  ).trim() || 'unknown'
  const forwardedForLeftmost = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || '-'

  return `${connectionIp}|${forwardedForLeftmost}`
}

function getLimiter(): RateLimiter | null {
  if (testLimiter !== undefined) return testLimiter
  if (limiter !== undefined) return limiter

  if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) {
    if (env.NODE_ENV !== 'test' && !warnedMissingRedis) {
      console.warn('Rate-limit disabled: missing UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN')
      warnedMissingRedis = true
    }

    limiter = null
    return limiter
  }

  const redis = new Redis({
    url: env.UPSTASH_REDIS_REST_URL,
    token: env.UPSTASH_REDIS_REST_TOKEN,
  })

  limiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(PUBLIC_RATE_LIMIT, PUBLIC_RATE_WINDOW),
    prefix: PUBLIC_RATE_LIMIT_PREFIX,
  })

  return limiter
}

export const publicRateLimit = createMiddleware(async (c, next) => {
  const activeLimiter = getLimiter()
  if (!activeLimiter) {
    await next()
    return
  }

  const clientId = getClientId(c)
  const result = await activeLimiter.limit(clientId)
  void result.pending?.catch(() => undefined)

  c.header('X-RateLimit-Limit', String(result.limit))
  c.header('X-RateLimit-Remaining', String(result.remaining))
  c.header('X-RateLimit-Reset', String(result.reset))

  if (!result.success) {
    const retryAfter = Math.max(1, Math.ceil((result.reset - Date.now()) / 1000))
    c.header('Retry-After', String(retryAfter))
    return c.json({ error: 'Rate limit exceeded', retry_after: retryAfter }, 429)
  }

  await next()
})

export function setRateLimitLimiterForTests(nextLimiter: RateLimiter | null | undefined) {
  testLimiter = nextLimiter
}
