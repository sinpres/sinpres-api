import { OpenAPIHono, createRoute } from '@hono/zod-openapi'
import { z } from 'zod'
import { SectorsResponseSchema, SectorResponseSchema } from './sectors.schema'
import { getAllSectors, getSectorBySlug } from './sectors.service'
import { notFound } from '../../shared/errors'
import { optionalApiKeySecurity } from '../../shared/openapi'

export const sectorsApp = new OpenAPIHono()

const listRoute = createRoute({
  method: 'get',
  path: '/api/v1/sectors',
  tags: ['Sectors'],
  security: optionalApiKeySecurity,
  summary: 'Listar setores',
  description: 'Retorna todos os setores disponíveis para consulta. Use o campo `slug` do setor para acessar suas categorias e itens.',
  responses: {
    200: {
      content: { 'application/json': { schema: SectorsResponseSchema } },
      description: 'Lista de setores disponíveis',
    },
  },
})

const getRoute = createRoute({
  method: 'get',
  path: '/api/v1/sectors/{slug}',
  tags: ['Sectors'],
  security: optionalApiKeySecurity,
  summary: 'Detalhar setor',
  description: 'Retorna os detalhes de um setor específico pelo seu slug. Exemplo: `civil-construction`.',
  request: {
    params: z.object({ slug: z.string().openapi({ example: 'civil-construction' }) }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: SectorResponseSchema } },
      description: 'Detalhes do setor',
    },
    404: {
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
      description: 'Setor não encontrado',
    },
  },
})

sectorsApp.openapi(listRoute, async (c) => {
  const data = await getAllSectors()
  return c.json({ data }, 200)
})

sectorsApp.openapi(getRoute, async (c) => {
  const { slug } = c.req.valid('param')
  const sector = await getSectorBySlug(slug)
  if (!sector) return notFound(c, 'Sector not found')
  return c.json({ data: sector }, 200)
})
