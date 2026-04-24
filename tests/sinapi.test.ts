import { describe, it, expect } from 'vitest'
import { app } from '../src/app'

describe('SINAPI Metadata', () => {
  describe('GET /api/v1/sinapi/states', () => {
    it('returns list of available states', async () => {
      const res = await app.request('/api/v1/sinapi/states')
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(Array.isArray(body.data)).toBe(true)
      expect(body.data.length).toBeGreaterThan(0)
      expect(body.data.every((s: any) => typeof s === 'string' && s.length === 2)).toBe(true)
    })
  })

  describe('GET /api/v1/sinapi/reference-months', () => {
    it('returns list of reference months', async () => {
      const res = await app.request('/api/v1/sinapi/reference-months')
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(Array.isArray(body.data)).toBe(true)
      expect(body.data.length).toBeGreaterThan(0)
      expect(body.data.every((m: any) => /^\d{4}-\d{2}$/.test(m))).toBe(true)
    })

    it('filters by state when provided', async () => {
      const res = await app.request('/api/v1/sinapi/reference-months?state=SP')
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(Array.isArray(body.data)).toBe(true)
    })
  })
})
