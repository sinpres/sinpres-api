import { OpenAPIHono, createRoute } from '@hono/zod-openapi'
import { z } from 'zod'
import { CategoriesResponseSchema } from './categories.schema'
import { getCategoriesBySector } from './categories.service'
import { getSectorBySlug } from '../sectors/sectors.service'
import { notFound } from '../../shared/errors'

export const categoriesApp = new OpenAPIHono()

const listRoute = createRoute({
  method: 'get',
  path: '/api/v1/sectors/{slug}/categories',
  tags: ['Categories'],
  summary: 'Listar categorias de um setor',
  description: 'Retorna todas as categorias de itens disponíveis dentro de um setor específico.',
  request: {
    params: z.object({ slug: z.string().openapi({ example: 'civil-construction' }) }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: CategoriesResponseSchema } },
      description: 'Lista de categorias do setor',
    },
    404: {
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
      description: 'Setor não encontrado',
    },
  },
})

categoriesApp.openapi(listRoute, async (c) => {
  const { slug } = c.req.valid('param')
  const sector = await getSectorBySlug(slug)
  if (!sector) return notFound(c, 'Sector not found')
  const data = await getCategoriesBySector(sector.schemaName)
  return c.json({ data }, 200)
})
