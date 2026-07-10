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

    it('matches accented descriptions with an unaccented query', async () => {
      const res = await app.request('/api/v1/sectors/civil-construction/compositions?search=ceramico')
      expect(res.status).toBe(200)
      const body = await res.json()
      // "CERÂMICO" descriptions are matched by the unaccented query "ceramico"
      expect(body.data.map((c: any) => c.code)).toContain(1002)
    })

    it('orders search results by relevance rather than code', async () => {
      const res = await app.request(`/api/v1/sectors/civil-construction/compositions?search=${encodeURIComponent('parede revestimento')}`)
      expect(res.status).toBe(200)
      const body = await res.json()
      // 1004 outranks the lower code 1003 → relevance, not code order, drives the result
      expect(body.data.map((c: any) => c.code)).toEqual([1004, 1003])
    })

    it('falls back to trigram similarity when full-text search misses a typo', async () => {
      const res = await app.request(`/api/v1/sectors/civil-construction/compositions?search=${encodeURIComponent('revestimemto ceramico')}`)
      expect(res.status).toBe(200)
      const body = await res.json()
      // one-letter typo of "revestimento cerâmico"; trigram recovers 1002 (closest) first
      expect(body.data.length).toBeGreaterThan(0)
      expect(body.data[0].code).toBe(1002)
    })

    it('still falls back to trigram similarity for a typo when include_total=false', async () => {
      const res = await app.request(`/api/v1/sectors/civil-construction/compositions?search=${encodeURIComponent('revestimemto ceramico')}&include_total=false`)
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.data.length).toBeGreaterThan(0)
      expect(body.data[0].code).toBe(1002)
    })

    it('returns the sole FTS match on page 1 for a query where trigram would otherwise match more rows', async () => {
      // "parede ceramico revestida" FTS-matches only 1003, but trigram (>0.25) also
      // matches 1002 and 1004 — this is the fixture that exposes the pagination bug below.
      const res = await app.request(`/api/v1/sectors/civil-construction/compositions?search=${encodeURIComponent('parede ceramico revestida')}&page=1&limit=1&include_total=false`)
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.data.map((c: any) => c.code)).toEqual([1003])
    })

    it('returns an empty page (not trigram noise) when paging past the FTS match set with include_total=false', async () => {
      // Same query as above, one page further: only 1 real FTS match exists, so page 2
      // must come back empty instead of leaking a trigram-only row (1002 or 1004).
      const res = await app.request(`/api/v1/sectors/civil-construction/compositions?search=${encodeURIComponent('parede ceramico revestida')}&page=2&limit=1&include_total=false`)
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.data).toEqual([])
      expect(body.meta.hasNextPage).toBe(false)
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

    it('computes the national average cost across UFs', async () => {
      const res = await app.request('/api/v1/sectors/civil-construction/compositions?national=true&month=2026-04&limit=10')
      expect(res.status).toBe(200)
      const body = await res.json()
      const alvenaria = body.data.find((c: any) => c.code === 1001)
      expect(alvenaria).toBeDefined()
      expect(alvenaria.stateCode).toBe('BR')
      expect(alvenaria.baseUnitCost).toBe(15000)
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

    it('returns the national average cost for a composition, including per-child averages', async () => {
      const res = await app.request('/api/v1/sectors/civil-construction/compositions/1001?national=true&month=2026-04')
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.data.code).toBe(1001)
      expect(body.data.stateCode).toBe('BR')
      expect(body.data.referenceMonth).toBe('2026-04')
      expect(body.data.baseUnitCost).toBe(15000)
      const cimento = body.data.items.find((i: any) => i.code === 3)
      expect(cimento.unitPrice).toBe(900)
      expect(cimento.totalPrice).toBe(225)
    })

    it('averages a sub-composition child at the national coordinate too', async () => {
      const res = await app.request('/api/v1/sectors/civil-construction/compositions/1003?national=true&month=2026-04')
      expect(res.status).toBe(200)
      const body = await res.json()
      const subComposition = body.data.items.find((i: any) => i.itemType === 'SUB_COMPOSITION')
      expect(subComposition.code).toBe(1002)
      // 1002's own national baseUnitCost (SP-only price 8500) is used for the child row
      expect(subComposition.unitPrice).toBe(8500)
    })

    it('rejects combining state and national for composition detail', async () => {
      const res = await app.request('/api/v1/sectors/civil-construction/compositions/1001?national=true&state=SP')
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body).toEqual({ error: 'Use either state or national, not both' })
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
