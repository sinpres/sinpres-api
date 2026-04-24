import { OpenAPIHono, createRoute } from '@hono/zod-openapi'
import { z } from 'zod'
import { getAvailableStates, getReferenceMonths } from './sinapi.service'

export const sinapiApp = new OpenAPIHono()

const statesResponseSchema = z.object({
  data: z.array(z.string().length(2)),
})

const referenceMonthsResponseSchema = z.object({
  data: z.array(z.string().regex(/^\d{4}-\d{2}$/)),
})

const statesRoute = createRoute({
  method: 'get',
  path: '/api/v1/sinapi/states',
  tags: ['SINAPI'],
  summary: 'Listar UFs disponíveis',
  description: 'Retorna a lista de UFs (estados) que possuem dados de insumos ou composições no SINAPI.',
  responses: {
    200: {
      content: { 'application/json': { schema: statesResponseSchema } },
      description: 'Lista de UFs disponíveis',
    },
  },
})

const referenceMonthsRoute = createRoute({
  method: 'get',
  path: '/api/v1/sinapi/reference-months',
  tags: ['SINAPI'],
  summary: 'Listar meses de referência disponíveis',
  description: 'Retorna a lista de meses de referência disponíveis, ordenados do mais recente para o mais antigo. Opcionalmente filtre por UF.',
  request: {
    query: z.object({
      state: z.string().length(2).optional().openapi({ example: 'SP', description: 'UF de 2 letras para filtrar meses disponíveis' }),
    }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: referenceMonthsResponseSchema } },
      description: 'Lista de meses de referência disponíveis',
    },
  },
})

sinapiApp.openapi(statesRoute, async (c) => {
  const states = await getAvailableStates()
  return c.json({ data: states }, 200)
})

sinapiApp.openapi(referenceMonthsRoute, async (c) => {
  const { state } = c.req.valid('query')
  const months = await getReferenceMonths(state)
  return c.json({ data: months }, 200)
})
