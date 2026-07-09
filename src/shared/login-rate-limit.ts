import { Ratelimit } from '@upstash/ratelimit'
import { getRedis, type RateLimiter } from './rate-limit'

const ACCOUNT_RATE_LIMIT = 5
const IP_RATE_LIMIT = 20
const LOGIN_RATE_WINDOW = '15 m'

let accountLimiter: RateLimiter | null | undefined
let ipLimiter: RateLimiter | null | undefined
let testLimiter: RateLimiter | null | undefined
let warnedLimiterError = false

function buildLimiter(limit: number, prefix: string): RateLimiter | null {
  const redis = getRedis()
  if (!redis) return null
  return new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(limit, LOGIN_RATE_WINDOW),
    prefix,
  })
}

function getAccountLimiter(): RateLimiter | null {
  if (testLimiter !== undefined) return testLimiter
  if (accountLimiter === undefined) accountLimiter = buildLimiter(ACCOUNT_RATE_LIMIT, 'rl:login')
  return accountLimiter
}

function getIpLimiter(): RateLimiter | null {
  if (testLimiter !== undefined) return testLimiter
  if (ipLimiter === undefined) ipLimiter = buildLimiter(IP_RATE_LIMIT, 'rl:login:ip')
  return ipLimiter
}

// Fail-open when no limiter is configured OR the backend throws at runtime: a
// rate-limit outage must not lock operators out, consistent with the public limiter.
async function runBucket(
  limiter: RateLimiter | null,
  identifier: string,
): Promise<{ ok: boolean; retryAfter: number }> {
  if (!limiter) return { ok: true, retryAfter: 0 }
  try {
    const result = await limiter.limit(identifier)
    void result.pending?.catch(() => undefined)
    const retryAfter = Math.max(1, Math.ceil((result.reset - Date.now()) / 1000))
    return { ok: result.success, retryAfter }
  } catch (error) {
    if (!warnedLimiterError) {
      warnedLimiterError = true
      console.warn('Login rate-limit check failed, failing open', error)
    }
    return { ok: true, retryAfter: 0 }
  }
}

// Two buckets: per-account (email) caps attempts against one account; per real-IP
// caps email-varying spraying, which the account bucket alone can't see because
// each fresh email is a new key. Either bucket denying wins, with the larger retryAfter.
export async function checkLoginRateLimit(
  email: string,
  realIp: string,
): Promise<{ ok: boolean; retryAfter: number }> {
  const account = await runBucket(getAccountLimiter(), `account:${email}`)
  const ip = await runBucket(getIpLimiter(), `ip:${realIp}`)
  return {
    ok: account.ok && ip.ok,
    retryAfter: Math.max(account.retryAfter, ip.retryAfter),
  }
}

export function setLoginRateLimiterForTests(limiter: RateLimiter | null | undefined) {
  testLimiter = limiter
}
