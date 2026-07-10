import { OpenAPIHono, createRoute } from '@hono/zod-openapi'
import { z } from 'zod'
import { getUnitsBySector } from './units.service'
import { getSectorBySlug } from '../sectors/sectors.service'
import { notFound } from '../../shared/errors'
import { optionalApiKeySecurity } from '../../shared/openapi'

export const unitsApp = new OpenAPIHono()

const unitsResponseSchema = z.object({
  data: z.array(z.string()),
})

const listRoute = createRoute({
  method: 'get',
  path: '/api/v1/sectors/{slug}/units',
  tags: ['Units'],
  security: optionalApiKeySecurity,
  summary: 'Listar unidades de medida de um setor',
  description: 'Retorna a lista canônica de unidades de medida (uppercase, ordenada alfabeticamente) usadas por insumos e composições de um setor — união de `item_catalog` e `composition_catalog`.',
  request: {
    params: z.object({ slug: z.string().openapi({ example: 'civil-construction' }) }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: unitsResponseSchema } },
      description: 'Lista de unidades de medida do setor',
    },
    404: {
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
      description: 'Setor não encontrado',
    },
  },
})

unitsApp.openapi(listRoute, async (c) => {
  const { slug } = c.req.valid('param')

  const sector = await getSectorBySlug(slug)
  if (!sector) return notFound(c, 'Sector not found')

  const data = await getUnitsBySector(sector.schemaName)
  return c.json({ data }, 200)
})
