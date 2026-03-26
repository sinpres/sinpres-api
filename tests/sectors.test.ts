import { describe, it, expect } from 'vitest'
import { app } from '../src/app'

describe('Sectors', () => {
  describe('GET /api/v1/sectors', () => {
    it('returns 200 with array of sectors', async () => {
      const res = await app.request('/api/v1/sectors')
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toHaveProperty('data')
      expect(Array.isArray(body.data)).toBe(true)
    })
  })

  describe('GET /api/v1/sectors/:slug', () => {
    it('returns 404 for unknown slug', async () => {
      const res = await app.request('/api/v1/sectors/nonexistent')
      expect(res.status).toBe(404)
    })
  })
})
