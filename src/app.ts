import { OpenAPIHono } from '@hono/zod-openapi'
import { healthApp } from './modules/health/health.routes'
import { sectorsApp } from './modules/sectors/sectors.routes'
import { categoriesApp } from './modules/categories/categories.routes'
import { itemsApp } from './modules/items/items.routes'
import { cors } from 'hono/cors'

export const app = new OpenAPIHono()

// CORS
app.use('*', cors())

// Routes
app.route('/', healthApp)
app.route('/', sectorsApp)
app.route('/', categoriesApp)
app.route('/', itemsApp)

// OpenAPI spec
app.doc('/doc', {
  openapi: '3.1.0',
  info: {
    title: 'SINPRES API',
    version: '1.0.0',
    description: `# SINPRES — Sistema Nacional de Preços Setoriais

API pública e open-source para consulta de preços e insumos por setor da economia brasileira.

## Sobre o projeto

O SINPRES organiza dados públicos de referência de preços de diferentes setores em uma API unificada. Cada setor possui seu próprio schema isolado no banco de dados, garantindo organização e escalabilidade.

## Bases de dados disponíveis

| Setor | Slug | Fonte | Itens | Status |
|---|---|---|---|---|
| **Construção Civil** | \`civil-construction\` | [SINAPI](https://www.caixa.gov.br/poder-publico/modernizacao-gestao/sinapi/) — Caixa Econômica Federal / IBGE | 6.009 insumos | Disponível |
| **Saúde** | \`health\` | — | — | Em breve |
| **Alimentação** | \`food\` | — | — | Em breve |
| **Energia** | \`energy\` | — | — | Em breve |

## Como usar

### 1. Listar setores disponíveis
\`\`\`
GET /api/v1/sectors
\`\`\`

### 2. Buscar insumos por texto (full-text search em português)
\`\`\`
GET /api/v1/sectors/civil-construction/items?search=tubo pvc
\`\`\`

### 3. Filtrar por unidade de medida
\`\`\`
GET /api/v1/sectors/civil-construction/items?unit=KG
\`\`\`

### 4. Buscar insumo por código
\`\`\`
GET /api/v1/sectors/civil-construction/items/34
\`\`\`

### 5. Paginação
\`\`\`
GET /api/v1/sectors/civil-construction/items?page=2&limit=20
\`\`\`

## Unidades de medida disponíveis (Construção Civil)

\`KG\`, \`M\`, \`M2\`, \`M3\`, \`UN\`, \`L\`, \`CJ\`, \`JG\`, \`PAR\`, \`H\`, \`DIA\`, \`MES\`, \`T\`, \`MIL\`, \`CENTO\`, \`SC25KG\`, \`KWH\`, \`100M\`, \`310ML\`, \`MXMES\`, \`M2XMES\`, \`M/MES\`, \`UNXMES\`

## Links

- [GitHub — sinpres-api](https://github.com/sinpres/sinpres-api)
- [TREE.IA](https://tree.ia.br)
`,
    contact: {
      name: 'TREE.IA',
      url: 'https://tree.ia.br',
    },
    license: {
      name: 'MIT',
      url: 'https://opensource.org/licenses/MIT',
    },
  },
  tags: [
    {
      name: 'Health',
      description: 'Verificação de status da API.',
    },
    {
      name: 'Sectors',
      description: 'Setores da economia disponíveis para consulta. Cada setor possui sua própria base de dados isolada com categorias e itens. Use o `slug` do setor para acessar seus dados.',
    },
    {
      name: 'Categories',
      description: 'Categorias de itens dentro de um setor. Permite organizar os itens por tipo (ex: materiais hidráulicos, elétricos, estruturais, etc.).',
    },
    {
      name: 'Items',
      description: 'Itens (insumos) de um setor. Suporta busca textual em português (full-text search), filtro por unidade de medida e paginação. Cada item possui código, descrição, unidade, normas técnicas, informações gerais e imagem de referência.',
    },
  ],
})

