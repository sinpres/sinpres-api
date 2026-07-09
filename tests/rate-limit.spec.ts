import { afterEach, describe, expect, it } from 'vitest'
import { app } from '../src/app'
import { setRateLimitLimiterForTests } from '../src/shared/rate-limit'

function createMemoryLimiter(limit: number) {
  const hits = new Map<string, number>()
  const identifiers: string[] = []
  const rates: number[] = []

  return {
    identifiers,
    rates,
    limiter: {
      async limit(identifier: string, opts?: { rate?: number }) {
        const rate = opts?.rate ?? 1
        identifiers.push(identifier)
        rates.push(rate)
        const count = (hits.get(identifier) ?? 0) + rate
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
  it('usa o IP seguro como identificador; x-vercel-forwarded-for vence x-real-ip', async () => {
    const { limiter, identifiers } = createMemoryLimiter(10)
    setRateLimitLimiterForTests(limiter)

    const byRealIp = await app.request('/api/v1/sectors', {
      headers: { 'x-real-ip': '10.0.0.1' },
    })
    const byVercel = await app.request('/api/v1/sectors', {
      headers: {
        'x-vercel-forwarded-for': '203.0.113.7',
        'x-real-ip': '10.0.0.1',
      },
    })

    expect(byRealIp.status).toBe(200)
    expect(byVercel.status).toBe(200)
    expect(identifiers).toEqual(['10.0.0.1', '203.0.113.7'])
  })

  it('A1: cf-connecting-ip e x-forwarded-for forjados não mudam o bucket', async () => {
    const { limiter, identifiers } = createMemoryLimiter(10)
    setRateLimitLimiterForTests(limiter)

    await app.request('/api/v1/sectors', {
      headers: {
        'x-real-ip': '10.0.0.1',
        'cf-connecting-ip': '203.0.113.1',
        'x-forwarded-for': '203.0.113.2, 10.0.0.9',
      },
    })
    await app.request('/api/v1/sectors', {
      headers: {
        'x-real-ip': '10.0.0.1',
        'cf-connecting-ip': '198.51.100.9',
        'x-forwarded-for': '198.51.100.8',
      },
    })

    // Both requests share one bucket: only the secure IP counts, the spoofable
    // headers are ignored.
    expect(identifiers).toEqual(['10.0.0.1', '10.0.0.1'])
  })

  it('consome o custo por rota: padrão = 1, /bulk = 10, /expanded = 5', async () => {
    const { limiter, rates } = createMemoryLimiter(1000)
    setRateLimitLimiterForTests(limiter)

    await app.request('/api/v1/sectors', { headers: { 'x-real-ip': '10.0.0.1' } })
    await app.request('/api/v1/sectors/civil-construction/items/bulk', {
      method: 'POST',
      headers: { 'x-real-ip': '10.0.0.1', 'content-type': 'application/json' },
      body: JSON.stringify({ queries: [] }),
    })
    await app.request('/api/v1/sectors/civil-construction/compositions/1003/expanded', {
      headers: { 'x-real-ip': '10.0.0.1' },
    })

    expect(rates).toEqual([1, 10, 5])
  })

  it('retorna 429 com Retry-After quando a cota estoura', async () => {
    const { limiter } = createMemoryLimiter(1)
    setRateLimitLimiterForTests(limiter)

    await app.request('/api/v1/sectors', { headers: { 'x-real-ip': '10.0.0.1' } })
    const limited = await app.request('/api/v1/sectors', { headers: { 'x-real-ip': '10.0.0.1' } })

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

  it('degrada aberto (fail-open) quando o limiter lança erro do Redis', async () => {
    setRateLimitLimiterForTests({ async limit() { throw new Error('redis down') } })

    const res = await app.request('/api/v1/sectors', { headers: { 'x-real-ip': '10.0.0.1' } })

    expect(res.status).toBe(200)
  })
})
