import { afterEach, describe, expect, it } from 'vitest'
import { app } from '../src/app'
import { setRateLimitLimiterForTests } from '../src/shared/rate-limit'

function createMemoryLimiter(limit: number) {
  const hits = new Map<string, number>()
  const identifiers: string[] = []

  return {
    identifiers,
    limiter: {
      async limit(identifier: string) {
        identifiers.push(identifier)
        const count = (hits.get(identifier) ?? 0) + 1
        hits.set(identifier, count)
        const success = count <= limit

        return {
          success,
          limit,
          remaining: Math.max(limit - count, 0),
          reset: Date.now() + 60_000,
        }
      },
    },
  }
}

afterEach(() => {
  setRateLimitLimiterForTests(null)
})

describe('Rate-limit público', () => {
  it('gera buckets distintos combinando connection IP e leftmost X-Forwarded-For', async () => {
    const { limiter, identifiers } = createMemoryLimiter(1)
    setRateLimitLimiterForTests(limiter)

    const first = await app.request('/api/v1/sectors', {
      headers: {
        'x-real-ip': '10.0.0.1',
        'x-forwarded-for': '203.0.113.10, 10.0.0.2',
      },
    })
    const second = await app.request('/api/v1/sectors', {
      headers: {
        'x-real-ip': '10.0.0.1',
        'x-forwarded-for': '203.0.113.11, 10.0.0.2',
      },
    })

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(identifiers).toEqual([
      '10.0.0.1|203.0.113.10',
      '10.0.0.1|203.0.113.11',
    ])
  })

  it('spoofing de X-Forwarded-For não esgota a cota de outro connection IP', async () => {
    const { limiter } = createMemoryLimiter(1)
    setRateLimitLimiterForTests(limiter)

    const attacker = await app.request('/api/v1/sectors', {
      headers: {
        'x-real-ip': '10.0.0.50',
        'x-forwarded-for': '203.0.113.99',
      },
    })
    const victim = await app.request('/api/v1/sectors', {
      headers: {
        'x-real-ip': '10.0.0.99',
        'x-forwarded-for': '203.0.113.99',
      },
    })

    expect(attacker.status).toBe(200)
    expect(victim.status).toBe(200)
    expect(victim.headers.get('X-RateLimit-Remaining')).toBe('0')
  })

  it('sem X-Forwarded-For usa connection IP com marcador vazio', async () => {
    const { limiter, identifiers } = createMemoryLimiter(1)
    setRateLimitLimiterForTests(limiter)

    const res = await app.request('/api/v1/sectors', {
      headers: { 'x-real-ip': '10.0.0.7' },
    })

    expect(res.status).toBe(200)
    expect(identifiers).toEqual(['10.0.0.7|-'])
  })

  it('retorna 429 com Retry-After quando a cota estoura', async () => {
    const { limiter } = createMemoryLimiter(1)
    setRateLimitLimiterForTests(limiter)

    await app.request('/api/v1/sectors', {
      headers: {
        'x-real-ip': '10.0.0.1',
        'x-forwarded-for': '203.0.113.10',
      },
    })
    const limited = await app.request('/api/v1/sectors', {
      headers: {
        'x-real-ip': '10.0.0.1',
        'x-forwarded-for': '203.0.113.10',
      },
    })

    expect(limited.status).toBe(429)
    expect(limited.headers.get('Retry-After')).toBeTruthy()
    expect(limited.headers.get('X-RateLimit-Limit')).toBe('1')
    const body = await limited.json()
    expect(body.error).toBe('Rate limit exceeded')
    expect(body.retry_after).toBeGreaterThan(0)
  })

  it('não aplica rate-limit em /health nem /doc', async () => {
    const { limiter } = createMemoryLimiter(0)
    setRateLimitLimiterForTests(limiter)

    const health = await app.request('/health')
    const doc = await app.request('/doc')

    expect(health.status).toBe(200)
    expect(doc.status).toBe(200)
    expect(health.headers.get('X-RateLimit-Limit')).toBeNull()
    expect(doc.headers.get('X-RateLimit-Limit')).toBeNull()
  })
})
