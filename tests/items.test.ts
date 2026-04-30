import { describe, it, expect } from 'vitest'
import { app } from '../src/app'

describe('Items', () => {
  describe('GET /api/v1/sectors/:slug/items', () => {
    it('returns 404 for unknown sector', async () => {
      const res = await app.request('/api/v1/sectors/nonexistent/items')
      expect(res.status).toBe(404)
    })

    it('returns paginated items for valid sector', async () => {
      const res = await app.request('/api/v1/sectors/civil-construction/items')
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toHaveProperty('data')
      expect(body).toHaveProperty('meta')
      expect(body.meta).toHaveProperty('total')
      expect(body.meta).toHaveProperty('page')
      expect(body.meta).toHaveProperty('limit')
      expect(body.meta).toHaveProperty('totalPages')
      expect(Array.isArray(body.data)).toBe(true)
      expect(body.data.length).toBeLessThanOrEqual(50)
    })

    it('supports search query', async () => {
      const res = await app.request('/api/v1/sectors/civil-construction/items?search=acetileno')
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.data.length).toBeGreaterThan(0)
    })

    it('supports unit filter', async () => {
      const res = await app.request('/api/v1/sectors/civil-construction/items?unit=KG')
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.data.length).toBeGreaterThan(0)
      expect(body.data.every((item: any) => item.unit === 'KG')).toBe(true)
    })

    it('supports pagination', async () => {
      const res = await app.request('/api/v1/sectors/civil-construction/items?page=2&limit=10')
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.data.length).toBeLessThanOrEqual(10)
      expect(body.meta.page).toBe(2)
    })
  })

  describe('GET /api/v1/sectors/:slug/items/:code', () => {
    it('returns item by code', async () => {
      const res = await app.request('/api/v1/sectors/civil-construction/items/1?state=SP&month=2026-04')
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.data.code).toBe(1)
    })

    it('returns 404 for unknown code', async () => {
      const res = await app.request('/api/v1/sectors/civil-construction/items/999999')
      expect(res.status).toBe(404)
    })
  })

  describe('POST /api/v1/sectors/:slug/items/bulk', () => {
    it('returns valid and invalid codes preserving order', async () => {
      const res = await app.request('/api/v1/sectors/civil-construction/items/bulk', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          queries: [
            { code: '1', state: 'SP', month: '2026-04', is_desonerated: false },
            { code: '999999', state: 'SP', month: '2026-04', is_desonerated: false },
            { code: '2', state: 'SP', month: '2026-04', is_desonerated: false },
          ],
        }),
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.results.map((result: any) => result.code)).toEqual(['1', '999999', '2'])
      expect(body.results[0].found).toBe(true)
      expect(body.results[0].item.code).toBe(1)
      expect(body.results[1]).toEqual({
        code: '999999',
        found: false,
        reason: 'no_price_for_coordinate',
      })
      expect(body.results[2].found).toBe(true)
      expect(body.results[2].item.code).toBe(2)
    })

    it('enforces the 100 queries limit', async () => {
      const res = await app.request('/api/v1/sectors/civil-construction/items/bulk', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          queries: Array.from({ length: 101 }, (_, index) => ({
            code: String(index + 1),
            state: 'SP',
            month: '2026-04',
            is_desonerated: false,
          })),
        }),
      })

      expect(res.status).toBe(400)
    })

    it('returns the same response for duplicate queries', async () => {
      const res = await app.request('/api/v1/sectors/civil-construction/items/bulk', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          queries: [
            { code: '1', state: 'SP', month: '2026-04', is_desonerated: false },
            { code: '1', state: 'SP', month: '2026-04', is_desonerated: false },
          ],
        }),
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.results).toHaveLength(2)
      expect(body.results[0]).toEqual(body.results[1])
    })
  })

  describe('previousCode field', () => {
    it('returns previousCode null for items without substitution', async () => {
      const res = await app.request('/api/v1/sectors/civil-construction/items/1?state=SP&month=2026-04')
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.data).toHaveProperty('previousCode')
      expect(body.data.previousCode).toBeNull()
    })

    it('returns previousCode with the replaced code when populated', async () => {
      const res = await app.request('/api/v1/sectors/civil-construction/items/100?state=SP&month=2026-04')
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.data.code).toBe(100)
      expect(body.data.previousCode).toBe(99)
    })
  })
})
