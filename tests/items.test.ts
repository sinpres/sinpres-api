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
