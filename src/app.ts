import { OpenAPIHono } from '@hono/zod-openapi'
import { healthApp } from './modules/health/health.routes'
import { sectorsApp } from './modules/sectors/sectors.routes'
import { categoriesApp } from './modules/categories/categories.routes'
import { itemsApp } from './modules/items/items.routes'
import { compositionsApp } from './modules/compositions/compositions.routes'
import { sinapiApp } from './modules/sinapi/sinapi.routes'
import { adminApp } from './modules/admin/admin.routes'
import { cors } from 'hono/cors'
import { apiKeyAuth } from './shared/api-key-auth'

export const app = new OpenAPIHono()

// CORS
app.use('*', cors({
  origin: '*',
  exposeHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset', 'Retry-After'],
}))
app.use('/api/v1/*', apiKeyAuth)

// Routes
app.route('/', healthApp)
app.route('/', sectorsApp)
app.route('/', categoriesApp)
app.route('/', itemsApp)
app.route('/', compositionsApp)
app.route('/', sinapiApp)
app.route('/', adminApp)

app.openAPIRegistry.registerComponent('securitySchemes', 'ApiKeyAuth', {
  type: 'apiKey',
  in: 'header',
  name: 'X-Api-Key',
  description: 'Chave de integração para produtos internos (tier com limite por usuário final).',
})

app.openAPIRegistry.registerComponent('securitySchemes', 'AdminBearer', {
  type: 'http',
  scheme: 'bearer',
  description: 'Segredo compartilhado (ADMIN_API_SECRET) apresentado pelo painel web. Uso interno.',
})

// OpenAPI spec
app.doc('/doc', {
  openapi: '3.1.0',
  info: {
    title: 'SINPRES API',
    version: '1.1.0',
    description: `# SINPRES — Sistema Nacional de Preços Setoriais

API pública e open-source para consulta de preços, insumos e composições por setor da economia brasileira.

## Sobre o projeto

O SINPRES organiza dados públicos de referência de preços de diferentes setores em uma API unificada. Cada setor possui seu próprio schema isolado no banco de dados, garantindo organização e escalabilidade.

## Bases de dados disponíveis

| Setor | Slug | Fonte | Itens | Status |
|---|---|---|---|---|
| **Construção Civil** | \`civil-construction\` | [SINAPI](https://www.caixa.gov.br/poder-publico/modernizacao-gestao/sinapi/) — Caixa Econômica Federal / IBGE | Insumos + Composições por UF e mês | Disponível |
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

### 3. Buscar composições por texto
\`\`\`
GET /api/v1/sectors/civil-construction/compositions?search=alvenaria
\`\`\`

### 4. Detalhar composição com itens
\`\`\`
GET /api/v1/sectors/civil-construction/compositions/7327
\`\`\`

### 5. Filtrar por UF e mês de referência
\`\`\`
GET /api/v1/sectors/civil-construction/items?state=SP&month=2026-03
\`\`\`

### 6. Listar UFs disponíveis
\`\`\`
GET /api/v1/sinapi/states
\`\`\`

### 7. Listar meses de referência disponíveis
\`\`\`
GET /api/v1/sinapi/reference-months?state=SP
\`\`\`

## Autenticação e limites de uso

A API pública não exige chave: cada IP tem **100 requisições por minuto**. Produtos internos autenticam com o header \`X-Api-Key\` e podem enviar \`X-End-User-Id\` para separar a cota por usuário final — sem esse header o produto inteiro divide um único bucket, e ele é ignorado quando não há chave válida.

Chave inválida ou revogada retorna **401** e continua limitada pelo IP (não cai para o tier anônimo). Falta de escopo retorna **403**: rotas de insumos exigem \`read:items\`, composições exigem \`read:compositions\`; metadados (setores, categorias, SINAPI) pedem apenas uma chave válida.

Cada request consome unidades da cota conforme o custo: \`/bulk\` = 10, \`/expanded\` = 5, demais = 1. Os headers \`X-RateLimit-*\` refletem o consumo e \`Retry-After\` acompanha as respostas 429.

## Unidades de medida disponíveis (Construção Civil)

\`KG\`, \`M\`, \`M2\`, \`M3\`, \`UN\`, \`L\`, \`CJ\`, \`JG\`, \`PAR\`, \`H\`, \`DIA\`, \`MES\`, \`T\`, \`MIL\`, \`CENTO\`, \`SC25KG\`, \`KWH\`, \`100M\`, \`310ML\`, \`MXMES\`, \`M2XMES\`, \`M/MES\`, \`UNXMES\`

## Substituição de códigos (\`previousCode\`)

Os objetos de insumo e composição retornam o campo \`previousCode\`, que indica o código anterior quando a Caixa publica uma substituição explícita (ex: o código \`11616\` foi substituído pelo \`11281\`; nesse caso o registro do \`11281\` retorna \`previousCode: 11616\`).

Use este campo para **detectar se o código que você está consultando é um substituto de outro**, permitindo migrar registros locais (orçamentos, planilhas, integrações) sempre que o SINAPI reorganiza seu catálogo. Quando \`previousCode\` é \`null\`, o código é original e não substitui nenhum código anterior.

## Links

- [GitHub — sinpres-api](https://github.com/sinpres/sinpres-api)
- [TREE.IA](https://tree.ia.br?utm_source=sinpres&utm_medium=openapi&utm_campaign=api)
`,
    contact: {
      name: 'TREE.IA',
      url: 'https://tree.ia.br?utm_source=sinpres&utm_medium=openapi&utm_campaign=api',
    },
    license: {
      name: 'MIT',
      url: 'https://opensource.org/licenses/MIT',
    },
  },
  servers: [
    {
      url: 'https://api.sinpres.com.br',
      description: 'Production server',
    },
  ],
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
      description: 'Itens (insumos) de um setor. Suporta busca textual em português (full-text search), filtro por unidade de medida, UF, mês de referência, regime tributário e paginação. Cada item possui código, descrição, unidade, preço unitário, normas técnicas, informações gerais e imagem de referência.',
    },
    {
      name: 'Compositions',
      description: 'Composições (serviços completos) de um setor. No SINAPI, uma composição representa um serviço de construção civil com seus insumos e sub-composições, coeficientes e preços resultantes. Suporta busca textual, filtros por unidade, UF, mês e regime tributário.',
    },
    {
      name: 'SINAPI',
      description: 'Metadados e informações auxiliares sobre os dados SINAPI, como UFs disponíveis e meses de referência.',
    },
    {
      name: 'Admin',
      description: 'Autenticação de operadores internos e gestão de chaves de integração. Uso interno, não faz parte da API pública.',
    },
  ],
})
