import { describe, expect, it } from 'vitest'
import { app } from '../src/app'

const coordinate = 'state=SP&month=2026-04&is_desonerated=false'

describe('Expanded compositions', () => {
  it('returns a composition without sub-compositions', async () => {
    const res = await app.request(`/api/v1/sectors/civil-construction/compositions/1001/expanded?${coordinate}`)

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.code).toBe('1001')
    expect(body.data.depth).toBe(0)
    expect(body.data.item_type).toBe('COMPOSITION')
    expect(body.data.unit_price).toBe(15000)
    expect(body.data.truncated).toBe(false)
    expect(body.data.items).toHaveLength(2)
    expect(body.data.items.every((item: any) => item.item_type === 'INPUT')).toBe(true)
  })

  it('returns one sub-composition level with nested inputs', async () => {
    const res = await app.request(`/api/v1/sectors/civil-construction/compositions/1003/expanded?${coordinate}`)

    expect(res.status).toBe(200)
    const body = await res.json()
    const subComposition = body.data.items.find((item: any) => item.code === '1002')

    expect(subComposition).toBeDefined()
    expect(subComposition.item_type).toBe('SUB_COMPOSITION')
    expect(subComposition.depth).toBe(1)
    expect(subComposition.unit_price).toBe(8500)
    expect(subComposition.items).toHaveLength(1)
    expect(subComposition.items[0].item_type).toBe('INPUT')
  })

  it('returns three levels of composition tree', async () => {
    const res = await app.request(`/api/v1/sectors/civil-construction/compositions/1004/expanded?${coordinate}`)

    expect(res.status).toBe(200)
    const body = await res.json()
    const level1 = body.data.items.find((item: any) => item.code === '1003')
    const level2 = level1.items.find((item: any) => item.code === '1002')
    const level3 = level2.items.find((item: any) => item.code === '3')

    expect(level1.depth).toBe(1)
    expect(level2.depth).toBe(2)
    expect(level3.depth).toBe(3)
    expect(level3.item_type).toBe('INPUT')
    expect(body.data.truncated).toBe(false)
  })

  it('respects max_depth', async () => {
    const res = await app.request(`/api/v1/sectors/civil-construction/compositions/1004/expanded?${coordinate}&max_depth=1`)

    expect(res.status).toBe(200)
    const body = await res.json()

    expect(body.data.items).toHaveLength(1)
    expect(body.data.items[0].code).toBe('1003')
    expect(body.data.items[0].items).toHaveLength(0)
  })

  it('marks truncated when max_depth cuts an unresolved branch', async () => {
    const res = await app.request(`/api/v1/sectors/civil-construction/compositions/1004/expanded?${coordinate}&max_depth=1`)

    expect(res.status).toBe(200)
    const body = await res.json()

    expect(body.data.truncated).toBe(true)
    expect(body.data.items[0].truncated).toBe(true)
  })

  it('returns 404 for unknown code', async () => {
    const res = await app.request(`/api/v1/sectors/civil-construction/compositions/999999/expanded?${coordinate}`)

    expect(res.status).toBe(404)
  })

  it('returns unit_price null when the coordinate has no price', async () => {
    const res = await app.request(`/api/v1/sectors/civil-construction/compositions/1005/expanded?${coordinate}`)

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.code).toBe('1005')
    expect(body.data.unit_price).toBeNull()
  })
})
