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
      expect(Array.isArray(body.data)).toBe(true)
      expect(body.data.length).toBeLessThanOrEqual(50)
    })

    it('supports search query', async () => {
      const res = await app.request('/api/v1/sectors/civil-construction/compositions?search=alvenaria')
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.data.length).toBeGreaterThan(0)
    })

    it('supports unit filter', async () => {
      const res = await app.request('/api/v1/sectors/civil-construction/compositions?unit=M2')
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
  })

  describe('GET /api/v1/sectors/:slug/compositions/:code', () => {
    it('returns composition by code with items', async () => {
      const res = await app.request('/api/v1/sectors/civil-construction/compositions/1001')
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.data.code).toBe(1001)
      expect(body.data).toHaveProperty('items')
      expect(Array.isArray(body.data.items)).toBe(true)
      expect(body.data.items.length).toBeGreaterThan(0)
      expect(body.data.items[0]).toHaveProperty('itemType')
      expect(body.data.items[0]).toHaveProperty('coefficient')
    })

    it('returns 404 for unknown code', async () => {
      const res = await app.request('/api/v1/sectors/civil-construction/compositions/999999')
      expect(res.status).toBe(404)
    })
  })
})
