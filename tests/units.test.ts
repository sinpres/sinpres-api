import { describe, it, expect } from 'vitest'
import { app } from '../src/app'

describe('Units', () => {
  describe('GET /api/v1/sectors/:slug/units', () => {
    it('returns 404 for unknown sector', async () => {
      const res = await app.request('/api/v1/sectors/nonexistent/units')
      expect(res.status).toBe(404)
    })

    it('returns the union of item and composition units, uppercase and sorted', async () => {
      const res = await app.request('/api/v1/sectors/civil-construction/units')
      expect(res.status).toBe(200)
      const body = await res.json()
      // items use H, KG, M, M3, UN; compositions use M2 (tests/setup.ts fixture)
      expect(body.data).toEqual(['H', 'KG', 'M', 'M2', 'M3', 'UN'])
    })
  })
})
