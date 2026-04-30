import { describe, it, expect } from 'vitest'
import { app } from '../src/app'

describe('Compositions', () => {
  describe('GET /api/v1/sectors/:slug/compositions', () => {
    it('returns 404 for unknown sector', async () => {
      const res = await app.request('/api/v1/sectors/nonexistent/compositions')
      expect(res.status).toBe(404)
    })

    it('returns paginated compositions for valid sector', async () => {
      const res = await app.request('/api/v1/sectors/civil-construction/compositions')
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toHaveProperty('data')
      expect(body).toHaveProperty('meta')
      expect(body.meta).toHaveProperty('total')
      expect(body.meta).toHaveProperty('page')
      expect(body.meta).toHaveProperty('limit')
      expect(body.meta).toHaveProperty('totalPages')
      expect(body.meta).toHaveProperty('hasNextPage')
      expect(Array.isArray(body.data)).toBe(true)
      expect(body.data.length).toBeLessThanOrEqual(50)
    })

    it('returns catalog-only compositions when state is omitted', async () => {
      const res = await app.request('/api/v1/sectors/civil-construction/compositions?limit=1')
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.data).toHaveLength(1)
      expect(body.data[0].stateCode).toBeNull()
      expect(body.data[0].referenceMonth).toBeNull()
      expect(body.data[0].isDesonerated).toBeNull()
      expect(body.data[0].baseUnitCost).toBeNull()
    })

    it('supports search query', async () => {
      const res = await app.request('/api/v1/sectors/civil-construction/compositions?search=alvenaria')
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.data.length).toBeGreaterThan(0)
    })

    it('supports unit filter', async () => {
      const res = await app.request('/api/v1/sectors/civil-construction/compositions?unit=M2&state=SP&month=2026-04')
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.data.length).toBeGreaterThan(0)
      expect(body.data.every((item: any) => item.unit === 'M2')).toBe(true)
    })

    it('supports pagination', async () => {
      const res = await app.request('/api/v1/sectors/civil-construction/compositions?page=1&limit=1')
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.data.length).toBeLessThanOrEqual(1)
      expect(body.meta.page).toBe(1)
    })

    it('can skip total counts for faster pagination', async () => {
      const res = await app.request('/api/v1/sectors/civil-construction/compositions?state=SP&month=2026-04&include_total=false&limit=2')
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.data).toHaveLength(2)
      expect(body.meta.total).toBeNull()
      expect(body.meta.totalPages).toBeNull()
      expect(body.meta.hasNextPage).toBe(true)
    })

    it('supports compact list payloads', async () => {
      const res = await app.request('/api/v1/sectors/civil-construction/compositions?state=SP&month=2026-04&compact=true&limit=1')
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.data).toHaveLength(1)
      expect(body.data[0]).toHaveProperty('code')
      expect(body.data[0]).toHaveProperty('baseUnitCost')
      expect(body.data[0]).not.toHaveProperty('sourceUpdatedAt')
      expect(body.data[0]).not.toHaveProperty('createdAt')
      expect(body.data[0]).not.toHaveProperty('items')
    })
  })

  describe('GET /api/v1/sectors/:slug/compositions/:code', () => {
    it('returns composition by code with items and computed totalPrice', async () => {
      const res = await app.request('/api/v1/sectors/civil-construction/compositions/1001?state=SP&month=2026-04')
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.data.code).toBe(1001)
      expect(body.data).toHaveProperty('items')
      expect(Array.isArray(body.data.items)).toBe(true)
      expect(body.data.items.length).toBe(2)
      // CIMENTO (code 3): coefficient 0.25 × unitPrice 900 = totalPrice 225
      const cimento = body.data.items.find((i: any) => i.code === 3)
      expect(cimento).toBeDefined()
      expect(cimento.itemType).toBe('INPUT')
      expect(cimento.unitPrice).toBe(900)
      expect(cimento.totalPrice).toBe(225)
      // PEDREIRO (code 5): coefficient 1.5 × unitPrice 2500 = totalPrice 3750
      const pedreiro = body.data.items.find((i: any) => i.code === 5)
      expect(pedreiro).toBeDefined()
      expect(pedreiro.unitPrice).toBe(2500)
      expect(pedreiro.totalPrice).toBe(3750)
    })

    it('returns catalog-only composition detail when state is omitted', async () => {
      const res = await app.request('/api/v1/sectors/civil-construction/compositions/1001')
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.data.code).toBe(1001)
      expect(body.data.stateCode).toBeNull()
      expect(body.data.baseUnitCost).toBeNull()
      expect(body.data.items).toHaveLength(2)
      expect(body.data.items.every((item: any) => item.unitPrice === 0 && item.totalPrice === 0)).toBe(true)
    })

    it('returns 404 for unknown code', async () => {
      const res = await app.request('/api/v1/sectors/civil-construction/compositions/999999')
      expect(res.status).toBe(404)
    })
  })

  describe('POST /api/v1/sectors/:slug/compositions/bulk', () => {
    it('returns valid and invalid codes preserving order', async () => {
      const res = await app.request('/api/v1/sectors/civil-construction/compositions/bulk', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          queries: [
            { code: '1001', state: 'SP', month: '2026-04', is_desonerated: false },
            { code: '999999', state: 'SP', month: '2026-04', is_desonerated: false },
            { code: '1002', state: 'SP', month: '2026-04', is_desonerated: false },
          ],
        }),
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.results.map((result: any) => result.code)).toEqual(['1001', '999999', '1002'])
      expect(body.results[0].found).toBe(true)
      expect(body.results[0].composition.code).toBe(1001)
      expect(body.results[0].composition).not.toHaveProperty('items')
      expect(body.results[1]).toEqual({
        code: '999999',
        found: false,
        reason: 'no_price_for_coordinate',
      })
      expect(body.results[2].found).toBe(true)
      expect(body.results[2].composition.code).toBe(1002)
    })

    it('enforces the 100 queries limit', async () => {
      const res = await app.request('/api/v1/sectors/civil-construction/compositions/bulk', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          queries: Array.from({ length: 101 }, (_, index) => ({
            code: String(1000 + index),
            state: 'SP',
            month: '2026-04',
            is_desonerated: false,
          })),
        }),
      })

      expect(res.status).toBe(400)
    })

    it('returns the same response for duplicate queries', async () => {
      const res = await app.request('/api/v1/sectors/civil-construction/compositions/bulk', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          queries: [
            { code: '1001', state: 'SP', month: '2026-04', is_desonerated: false },
            { code: '1001', state: 'SP', month: '2026-04', is_desonerated: false },
          ],
        }),
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.results).toHaveLength(2)
      expect(body.results[0]).toEqual(body.results[1])
    })
  })
})
