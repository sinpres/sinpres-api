import { OpenAPIHono, createRoute } from '@hono/zod-openapi'
import { z } from 'zod'
import {
  CompositionsResponseSchema,
  CompositionResponseSchema,
  CompositionsQuerySchema,
  CompositionDetailQuerySchema,
  CompositionsBulkRequestSchema,
  CompositionsBulkResponseSchema,
  ExpandedCompositionQuerySchema,
  ExpandedCompositionResponseSchema,
} from './compositions.schema'
import { getCompositions, getCompositionByCode, getCompositionsBulk, getExpandedComposition } from './compositions.service'
import { getSectorBySlug } from '../sectors/sectors.service'
import { notFound } from '../../shared/errors'
import { paginationMeta } from '../../shared/pagination'

export const compositionsApp = new OpenAPIHono()

const listRoute = createRoute({
  method: 'get',
  path: '/api/v1/sectors/{slug}/compositions',
  tags: ['Compositions'],
  summary: 'Buscar composições de um setor',
  description: `Retorna uma lista paginada de composições (serviços SINAPI) de um setor.

**Busca textual:** Use o parâmetro \`search\` para buscar por descrição. A busca utiliza full-text search em português (PostgreSQL \`tsvector\`).

**Filtro por unidade:** Use o parâmetro \`unit\` para filtrar por unidade de medida (ex: M2, M3, UN).

**Filtro por UF:** Use o parâmetro \`state\` para filtrar por estado (ex: SP, RJ, MG).

**Filtro por mês:** Use o parâmetro \`month\` no formato AAAA-MM. Se não informado, retorna o último mês disponível.

**Regime tributário:** Use o parâmetro \`is_desonerated\` para filtrar por desoneração. Default: \`false\`.

**Paginação:** Use \`page\` e \`limit\` para controlar a paginação. Máximo de 100 itens por página.

**Performance:** Use \`include_total=false\` para evitar \`COUNT(*)\` e \`compact=true\` para retornar payload reduzido.`,
  request: {
    params: z.object({ slug: z.string().openapi({ example: 'civil-construction' }) }),
    query: CompositionsQuerySchema,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: CompositionsResponseSchema } },
      description: 'Lista paginada de composições com metadados de paginação',
    },
    404: {
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
      description: 'Setor não encontrado',
    },
  },
})

const getRoute = createRoute({
  method: 'get',
  path: '/api/v1/sectors/{slug}/compositions/{code}',
  tags: ['Compositions'],
  summary: 'Detalhar composição por código',
  description: 'Retorna os detalhes completos de uma composição (serviço SINAPI) pelo seu código de referência, incluindo todos os itens que a compõem (insumos e sub-composições) com coeficientes e preços.',
  request: {
    params: z.object({
      slug: z.string().openapi({ example: 'civil-construction' }),
      code: z.coerce.number().openapi({ example: 7327 }),
    }),
    query: CompositionDetailQuerySchema,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: CompositionResponseSchema } },
      description: 'Detalhes da composição com itens',
    },
    404: {
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
      description: 'Composição ou setor não encontrado',
    },
  },
})

const bulkRoute = createRoute({
  method: 'post',
  path: '/api/v1/sectors/{slug}/compositions/bulk',
  tags: ['Compositions'],
  summary: 'Buscar múltiplas composições por código',
  description: 'Retorna múltiplas composições em uma única request, preservando a ordem de entrada. Não retorna os itens da composição; use o endpoint expanded para árvore recursiva.',
  request: {
    params: z.object({ slug: z.string().openapi({ example: 'civil-construction' }) }),
    body: {
      content: {
        'application/json': {
          schema: CompositionsBulkRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: CompositionsBulkResponseSchema } },
      description: 'Resultados das composições solicitadas',
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

const expandedRoute = createRoute({
  method: 'get',
  path: '/api/v1/sectors/{slug}/compositions/{code}/expanded',
  tags: ['Compositions'],
  summary: 'Expandir composição recursivamente',
  description: 'Resolve a árvore de uma composição no servidor, incluindo insumos e sub-composições até a profundidade solicitada. O limite máximo aplicado pelo servidor é 8.',
  request: {
    params: z.object({
      slug: z.string().openapi({ example: 'civil-construction' }),
      code: z.coerce.number().openapi({ example: 87514 }),
    }),
    query: ExpandedCompositionQuerySchema,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: ExpandedCompositionResponseSchema } },
      description: 'Árvore expandida da composição',
    },
    404: {
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
      description: 'Composição ou setor não encontrado',
    },
  },
})

compositionsApp.openapi(listRoute, async (c) => {
  const { slug } = c.req.valid('param')
  const query = c.req.valid('query')

  const sector = await getSectorBySlug(slug)
  if (!sector) return notFound(c, 'Sector not found')

  const { compositions, total, hasNextPage } = await getCompositions(sector.schemaName, query)
  const meta = paginationMeta(total, query.page, query.limit, hasNextPage)

  return c.json({ data: compositions, meta }, 200)
})

compositionsApp.openapi(getRoute, async (c) => {
  const { slug, code } = c.req.valid('param')
  const query = c.req.valid('query')

  const sector = await getSectorBySlug(slug)
  if (!sector) return notFound(c, 'Sector not found')

  const composition = await getCompositionByCode(sector.schemaName, code, query)
  if (!composition) return notFound(c, 'Composition not found')

  return c.json({ data: composition }, 200)
})

compositionsApp.openapi(bulkRoute, async (c) => {
  const { slug } = c.req.valid('param')
  const body = c.req.valid('json')

  const sector = await getSectorBySlug(slug)
  if (!sector) return notFound(c, 'Sector not found')

  const results = await getCompositionsBulk(sector.schemaName, body.queries)

  return c.json({ results }, 200)
})

compositionsApp.openapi(expandedRoute, async (c) => {
  const { slug, code } = c.req.valid('param')
  const query = c.req.valid('query')

  const sector = await getSectorBySlug(slug)
  if (!sector) return notFound(c, 'Sector not found')

  const composition = await getExpandedComposition({
    slug: sector.schemaName,
    code,
    state: query.state,
    month: query.month,
    is_desonerated: query.is_desonerated,
    max_depth: query.max_depth,
  })
  if (!composition) return notFound(c, 'Composition not found')

  return c.json({ data: composition }, 200)
})
