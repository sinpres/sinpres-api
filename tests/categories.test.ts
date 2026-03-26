import { describe, it, expect } from 'vitest'
import { app } from '../src/app'

describe('Categories', () => {
  describe('GET /api/v1/sectors/:slug/categories', () => {
    it('returns 404 for unknown sector', async () => {
      const res = await app.request('/api/v1/sectors/nonexistent/categories')
      expect(res.status).toBe(404)
    })

    it('returns 200 with array for valid sector', async () => {
      const res = await app.request('/api/v1/sectors/civil-construction/categories')
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toHaveProperty('data')
      expect(Array.isArray(body.data)).toBe(true)
    })
  })
})
