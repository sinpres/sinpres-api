import { OpenAPIHono, createRoute } from '@hono/zod-openapi'
import { z } from 'zod'
import { ItemsResponseSchema, ItemResponseSchema, ItemsQuerySchema, ItemDetailQuerySchema, ItemsBulkRequestSchema, ItemsBulkResponseSchema } from './items.schema'
import { getItems, getItemByCode, getItemsBulk } from './items.service'
import { getSectorBySlug } from '../sectors/sectors.service'
import { notFound } from '../../shared/errors'
import { paginationMeta } from '../../shared/pagination'
export const itemsApp = new OpenAPIHono()

const listRoute = createRoute({
  method: 'get',
  path: '/api/v1/sectors/{slug}/items',
  tags: ['Items'],
  summary: 'Buscar itens de um setor',
  description: `Retorna uma lista paginada de itens (insumos) de um setor.

**Busca textual:** Use o parâmetro \`search\` para buscar por descrição ou informações gerais. A busca utiliza full-text search em português (PostgreSQL \`tsvector\`).

**Filtro por unidade:** Use o parâmetro \`unit\` para filtrar por unidade de medida (ex: KG, M, M2, UN).

**Filtro por UF:** Use o parâmetro \`state\` para filtrar por estado (ex: SP, RJ, MG).

**Filtro por mês:** Use o parâmetro \`month\` no formato AAAA-MM. Se não informado, retorna o último mês disponível.

**Regime tributário:** Use o parâmetro \`is_desonerated\` para filtrar por desoneração. Default: \`false\`.

**Paginação:** Use \`page\` e \`limit\` para controlar a paginação. Máximo de 100 itens por página.

**Performance:** Use \`include_total=false\` para evitar \`COUNT(*)\` e \`compact=true\` para retornar payload reduzido.`,
  request: {
    params: z.object({ slug: z.string().openapi({ example: 'civil-construction' }) }),
    query: ItemsQuerySchema,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: ItemsResponseSchema } },
      description: 'Lista paginada de itens com metadados de paginação',
    },
    404: {
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
      description: 'Setor não encontrado',
    },
  },
})

const getRoute = createRoute({
  method: 'get',
  path: '/api/v1/sectors/{slug}/items/{code}',
  tags: ['Items'],
  summary: 'Detalhar item por código',
  description: 'Retorna os detalhes completos de um item (insumo) pelo seu código de referência. Para Construção Civil, o código corresponde ao código SINAPI. Aceita filtros opcionais de UF, mês e regime tributário.',
  request: {
    params: z.object({
      slug: z.string().openapi({ example: 'civil-construction' }),
      code: z.coerce.number().openapi({ example: 34 }),
    }),
    query: ItemDetailQuerySchema,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: ItemResponseSchema } },
      description: 'Detalhes do item',
    },
    404: {
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
      description: 'Item ou setor não encontrado',
    },
  },
})

const bulkRoute = createRoute({
  method: 'post',
  path: '/api/v1/sectors/{slug}/items/bulk',
  tags: ['Items'],
  summary: 'Buscar múltiplos insumos por código',
  description: 'Retorna múltiplos insumos em uma única request, preservando a ordem de entrada e evitando N+1 no consumidor. Limite máximo de 100 consultas por request.',
  request: {
    params: z.object({ slug: z.string().openapi({ example: 'civil-construction' }) }),
    body: {
      content: {
        'application/json': {
          schema: ItemsBulkRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: ItemsBulkResponseSchema } },
      description: 'Resultados dos insumos solicitados',
    },
    400: {
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
      description: 'Payload inválido ou acima do limite de 100 consultas',
    },
    404: {
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
      description: 'Setor não encontrado',
    },
  },
})

itemsApp.openapi(listRoute, async (c) => {
  const { slug } = c.req.valid('param')
  const query = c.req.valid('query')

  const sector = await getSectorBySlug(slug)
  if (!sector) return notFound(c, 'Sector not found')

  const { items, total, hasNextPage } = await getItems(sector.schemaName, query)
  const meta = paginationMeta(total, query.page, query.limit, hasNextPage)

  return c.json({ data: items, meta }, 200)
})

itemsApp.openapi(getRoute, async (c) => {
  const { slug, code } = c.req.valid('param')
  const query = c.req.valid('query')

  const sector = await getSectorBySlug(slug)
  if (!sector) return notFound(c, 'Sector not found')

  const item = await getItemByCode(sector.schemaName, code, query)
  if (!item) return notFound(c, 'Item not found')

  return c.json({ data: item }, 200)
})

itemsApp.openapi(bulkRoute, async (c) => {
  const { slug } = c.req.valid('param')
  const body = c.req.valid('json')

  const sector = await getSectorBySlug(slug)
  if (!sector) return notFound(c, 'Sector not found')

  const results = await getItemsBulk(sector.schemaName, body.queries)

  return c.json({ results }, 200)
})
