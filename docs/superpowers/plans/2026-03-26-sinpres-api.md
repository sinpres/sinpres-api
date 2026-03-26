# SINPRES API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a multi-sector public REST API for querying national pricing data, starting with civil construction (SINAPI).

**Architecture:** Hono framework with OpenAPI spec auto-generation, Drizzle ORM with PostgreSQL isolated schemas per sector, full-text search in Portuguese. Each sector lives in its own PostgreSQL schema (`civil_construction`, `health`, etc.) with identical table structures. A shared `public` schema holds the `sectors` registry.

**Tech Stack:** Bun, Hono + @hono/zod-openapi, Drizzle ORM, PostgreSQL (with schemas), Zod, Scalar (API docs), Vitest

---

## File Structure

```
sinpres-api/
├── src/
│   ├── index.ts                          # Entry point — starts HTTP server
│   ├── app.ts                            # Hono app — mounts routes, middleware, docs
│   ├── env.ts                            # Environment config with Zod validation
│   ├── db/
│   │   ├── client.ts                     # Drizzle client instance
│   │   ├── schema/
│   │   │   ├── public.ts                 # public schema — sectors table
│   │   │   ├── civil-construction.ts     # civil_construction schema — categories, items
│   │   │   └── index.ts                  # Re-exports all schemas
│   │   └── seed/
│   │       ├── seed.ts                   # Main seed runner
│   │       └── civil-construction.ts     # Seed civil_construction from JSON
│   ├── modules/
│   │   ├── health/
│   │   │   └── health.routes.ts          # GET /health
│   │   ├── sectors/
│   │   │   ├── sectors.routes.ts         # GET /api/v1/sectors, GET /api/v1/sectors/:slug
│   │   │   ├── sectors.service.ts        # Query logic
│   │   │   └── sectors.schema.ts         # Zod schemas + OpenAPI route definitions
│   │   ├── categories/
│   │   │   ├── categories.routes.ts      # GET /api/v1/sectors/:slug/categories
│   │   │   ├── categories.service.ts     # Query logic
│   │   │   └── categories.schema.ts      # Zod schemas + OpenAPI route definitions
│   │   └── items/
│   │       ├── items.routes.ts           # GET /api/v1/sectors/:slug/items, items/:code, items/:code/image
│   │       ├── items.service.ts          # Query logic + full-text search
│   │       └── items.schema.ts           # Zod schemas + OpenAPI route definitions
│   └── shared/
│       ├── pagination.ts                 # Pagination helper (limit, offset, total)
│       └── errors.ts                     # Error response helper
├── tests/
│   ├── setup.ts                          # Test setup — test DB connection
│   ├── health.test.ts
│   ├── sectors.test.ts
│   ├── categories.test.ts
│   └── items.test.ts
├── drizzle/                              # Generated migration files
├── drizzle.config.ts
├── vitest.config.ts
├── package.json
├── tsconfig.json
├── Dockerfile
├── docker-compose.yml
├── .env.example
├── .gitignore
└── README.md
```

---

### Task 1: Project Setup

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `docker-compose.yml`
- Create: `src/env.ts`

- [ ] **Step 1: Initialize Bun project**

```bash
cd /Users/lucaslimasza/Projetos/Outros/SINPRES/sinpres-api
rm -rf docs scripts output .DS_Store
bun init -y
```

- [ ] **Step 2: Install dependencies**

```bash
bun add hono @hono/zod-openapi zod drizzle-orm @scalar/hono-api-reference
bun add -D drizzle-kit vitest @types/bun
```

- [ ] **Step 3: Configure tsconfig.json**

Replace `tsconfig.json` with:

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "types": ["bun"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src/**/*.ts", "tests/**/*.ts", "drizzle.config.ts"]
}
```

- [ ] **Step 4: Create .env.example**

```env
DATABASE_URL=postgresql://sinpres:sinpres@localhost:5432/sinpres
PORT=3000
NODE_ENV=development
```

- [ ] **Step 5: Create docker-compose.yml**

```yaml
services:
  db:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: sinpres
      POSTGRES_PASSWORD: sinpres
      POSTGRES_DB: sinpres
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
```

- [ ] **Step 6: Create src/env.ts**

```typescript
import { z } from 'zod'

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
})

export const env = envSchema.parse(process.env)
```

- [ ] **Step 7: Create .gitignore**

```gitignore
node_modules/
dist/
.env
.DS_Store
```

- [ ] **Step 8: Update package.json scripts**

Add to `package.json`:

```json
{
  "scripts": {
    "dev": "bun run --hot src/index.ts",
    "start": "bun run src/index.ts",
    "db:generate": "bun drizzle-kit generate",
    "db:migrate": "bun drizzle-kit migrate",
    "db:seed": "bun run src/db/seed/seed.ts",
    "test": "vitest",
    "test:run": "vitest run"
  }
}
```

- [ ] **Step 9: Commit**

```bash
git add package.json tsconfig.json bun.lock .gitignore .env.example docker-compose.yml src/env.ts
git commit -m "chore: init project with bun, hono, drizzle"
```

---

### Task 2: Database Schema

**Files:**
- Create: `src/db/client.ts`
- Create: `src/db/schema/public.ts`
- Create: `src/db/schema/civil-construction.ts`
- Create: `src/db/schema/index.ts`
- Create: `drizzle.config.ts`

- [ ] **Step 1: Create Drizzle client**

Create `src/db/client.ts`:

```typescript
import { drizzle } from 'drizzle-orm/bun-sql'
import { env } from '@/env'
import * as schema from './schema'

export const db = drizzle(env.DATABASE_URL, { schema })
export type Database = typeof db
```

- [ ] **Step 2: Create public schema (sectors table)**

Create `src/db/schema/public.ts`:

```typescript
import { pgTable, serial, text, timestamp, varchar } from 'drizzle-orm/pg-core'

export const sectors = pgTable('sectors', {
  id: serial('id').primaryKey(),
  slug: varchar('slug', { length: 100 }).notNull().unique(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  schemaName: varchar('schema_name', { length: 100 }).notNull().unique(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})
```

- [ ] **Step 3: Create civil_construction schema**

Create `src/db/schema/civil-construction.ts`:

```typescript
import { pgSchema, serial, integer, text, varchar, timestamp, jsonb, index } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const civilConstructionSchema = pgSchema('civil_construction')

export const categories = civilConstructionSchema.table('categories', {
  id: serial('id').primaryKey(),
  slug: varchar('slug', { length: 100 }).notNull().unique(),
  name: varchar('name', { length: 255 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const items = civilConstructionSchema.table('items', {
  id: serial('id').primaryKey(),
  categoryId: integer('category_id').references(() => categories.id),
  code: integer('code').notNull().unique(),
  description: text('description').notNull(),
  unit: varchar('unit', { length: 20 }).notNull(),
  technicalStandards: text('technical_standards'),
  generalInfo: text('general_info'),
  imageUrl: varchar('image_url', { length: 500 }),
  metadata: jsonb('metadata'),
  sourceUpdatedAt: varchar('source_updated_at', { length: 20 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('items_code_idx').on(table.code),
  index('items_unit_idx').on(table.unit),
  index('items_search_idx').using(
    'gin',
    sql`to_tsvector('portuguese', ${table.description} || ' ' || coalesce(${table.generalInfo}, ''))`
  ),
])
```

- [ ] **Step 4: Create schema index**

Create `src/db/schema/index.ts`:

```typescript
export { sectors } from './public'
export {
  civilConstructionSchema,
  categories as civilConstructionCategories,
  items as civilConstructionItems,
} from './civil-construction'
```

- [ ] **Step 5: Create drizzle.config.ts**

```typescript
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  out: './drizzle',
  schema: './src/db/schema/*.ts',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
})
```

- [ ] **Step 6: Start database, generate and run migrations**

```bash
docker compose up -d
bun run db:generate
bun run db:migrate
```

Expected: Migration creates `sectors` table in `public` schema, and `categories` + `items` tables inside `civil_construction` schema with GIN index.

- [ ] **Step 7: Commit**

```bash
git add src/db/ drizzle.config.ts drizzle/
git commit -m "feat: add database schema with isolated sector schemas"
```

---

### Task 3: Seed Data

**Files:**
- Create: `src/db/seed/civil-construction.ts`
- Create: `src/db/seed/seed.ts`

The seed reads the `items.json` generated by `sinapi-extractor` and inserts into the database.

- [ ] **Step 1: Create civil construction seed**

Create `src/db/seed/civil-construction.ts`:

```typescript
import { db } from '../client'
import { sectors } from '../schema/public'
import { items as itemsTable, categories as categoriesTable } from '../schema/civil-construction'

interface RawItem {
  code: number
  description: string
  unit: string
  technical_standards: string
  general_info: string
  image: string
  source_updated_at: string
}

export async function seedCivilConstruction(dataPath: string) {
  const file = Bun.file(dataPath)
  const rawItems: RawItem[] = await file.json()

  console.log(`Seeding civil_construction with ${rawItems.length} items...`)

  // Upsert sector
  await db.insert(sectors).values({
    slug: 'civil-construction',
    name: 'Construção Civil',
    description: 'Sistema Nacional de Pesquisa de Custos e Índices da Construção Civil (SINAPI)',
    schemaName: 'civil_construction',
  }).onConflictDoNothing()

  // Insert items in batches of 500
  const batchSize = 500
  for (let i = 0; i < rawItems.length; i += batchSize) {
    const batch = rawItems.slice(i, i + batchSize).map((raw) => ({
      code: raw.code,
      description: raw.description,
      unit: raw.unit,
      technicalStandards: raw.technical_standards || null,
      generalInfo: raw.general_info || null,
      imageUrl: raw.image || null,
      sourceUpdatedAt: raw.source_updated_at || null,
    }))

    await db.insert(itemsTable).values(batch).onConflictDoNothing()
    console.log(`  ${Math.min(i + batchSize, rawItems.length)}/${rawItems.length} items inserted`)
  }

  console.log('Civil construction seed complete.')
}
```

- [ ] **Step 2: Create main seed runner**

Create `src/db/seed/seed.ts`:

```typescript
import { seedCivilConstruction } from './civil-construction'

const DATA_PATH = process.argv[2]

if (!DATA_PATH) {
  console.error('Usage: bun run src/db/seed/seed.ts <path-to-items.json>')
  process.exit(1)
}

async function main() {
  console.log('Starting seed...')
  await seedCivilConstruction(DATA_PATH)
  console.log('Seed complete.')
  process.exit(0)
}

main().catch((err) => {
  console.error('Seed failed:', err)
  process.exit(1)
})
```

- [ ] **Step 3: Run seed**

```bash
bun run src/db/seed/seed.ts /Users/lucaslimasza/Projetos/Outros/SINPRES/sinapi-extractor/output/items.json
```

Expected: `6009 items inserted` into `civil_construction.items`.

- [ ] **Step 4: Verify data in database**

```bash
docker compose exec db psql -U sinpres -c "SELECT count(*) FROM civil_construction.items;"
```

Expected: `6009`

- [ ] **Step 5: Commit**

```bash
git add src/db/seed/
git commit -m "feat: add seed script for civil construction data"
```

---

### Task 4: Shared Utilities

**Files:**
- Create: `src/shared/pagination.ts`
- Create: `src/shared/errors.ts`

- [ ] **Step 1: Create pagination helper**

Create `src/shared/pagination.ts`:

```typescript
import { z } from 'zod'

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

export type PaginationQuery = z.infer<typeof paginationQuerySchema>

export function paginationMeta(total: number, page: number, limit: number) {
  return {
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  }
}

export function paginationOffset(page: number, limit: number) {
  return (page - 1) * limit
}
```

- [ ] **Step 2: Create error helper**

Create `src/shared/errors.ts`:

```typescript
import type { Context } from 'hono'

export function notFound(c: Context, message = 'Resource not found') {
  return c.json({ error: message }, 404)
}

export function badRequest(c: Context, message = 'Bad request') {
  return c.json({ error: message }, 400)
}
```

- [ ] **Step 3: Commit**

```bash
git add src/shared/
git commit -m "feat: add pagination and error helpers"
```

---

### Task 5: Health Route + App Setup

**Files:**
- Create: `src/app.ts`
- Create: `src/index.ts`
- Create: `src/modules/health/health.routes.ts`
- Create: `vitest.config.ts`
- Create: `tests/setup.ts`
- Create: `tests/health.test.ts`

- [ ] **Step 1: Write the health route test**

Create `tests/health.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { app } from '../src/app'

describe('GET /health', () => {
  it('returns 200 with status ok', async () => {
    const res = await app.request('/health')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ status: 'ok' })
  })
})
```

- [ ] **Step 2: Create vitest config**

Create `vitest.config.ts`:

```typescript
import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
})
```

- [ ] **Step 3: Run test to verify it fails**

```bash
bun run test:run
```

Expected: FAIL — `app` module not found.

- [ ] **Step 4: Create health routes**

Create `src/modules/health/health.routes.ts`:

```typescript
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'

const healthRoute = createRoute({
  method: 'get',
  path: '/health',
  tags: ['Health'],
  responses: {
    200: {
      content: { 'application/json': { schema: z.object({ status: z.string() }) } },
      description: 'API is healthy',
    },
  },
})

export const healthApp = new OpenAPIHono()

healthApp.openapi(healthRoute, (c) => {
  return c.json({ status: 'ok' }, 200)
})
```

- [ ] **Step 5: Create app.ts**

Create `src/app.ts`:

```typescript
import { OpenAPIHono } from '@hono/zod-openapi'
import { apiReference } from '@scalar/hono-api-reference'
import { healthApp } from './modules/health/health.routes'

export const app = new OpenAPIHono()

// Routes
app.route('/', healthApp)

// OpenAPI spec
app.doc('/doc', {
  openapi: '3.1.0',
  info: {
    title: 'SINPRES API',
    version: '1.0.0',
    description: 'Sistema Nacional de Preços Setoriais — API pública de consulta de preços por setor.',
  },
})

// Scalar docs UI
app.get('/reference', apiReference({
  pageTitle: 'SINPRES API Reference',
  spec: { url: '/doc' },
}))
```

- [ ] **Step 6: Create index.ts**

Create `src/index.ts`:

```typescript
import { app } from './app'
import { env } from './env'

console.log(`SINPRES API running on http://localhost:${env.PORT}`)

export default {
  port: env.PORT,
  fetch: app.fetch,
}
```

- [ ] **Step 7: Run test to verify it passes**

```bash
bun run test:run
```

Expected: PASS

- [ ] **Step 8: Run dev server and verify manually**

```bash
bun run dev
```

Verify:
- `GET http://localhost:3000/health` → `{ "status": "ok" }`
- `GET http://localhost:3000/doc` → OpenAPI JSON
- `GET http://localhost:3000/reference` → Scalar docs UI

- [ ] **Step 9: Commit**

```bash
git add src/app.ts src/index.ts src/modules/health/ vitest.config.ts tests/
git commit -m "feat: add health route with OpenAPI docs and Scalar UI"
```

---

### Task 6: Sectors Module

**Files:**
- Create: `src/modules/sectors/sectors.schema.ts`
- Create: `src/modules/sectors/sectors.service.ts`
- Create: `src/modules/sectors/sectors.routes.ts`
- Create: `tests/sectors.test.ts`

- [ ] **Step 1: Write the sectors tests**

Create `tests/sectors.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { app } from '../src/app'

describe('Sectors', () => {
  describe('GET /api/v1/sectors', () => {
    it('returns 200 with array of sectors', async () => {
      const res = await app.request('/api/v1/sectors')
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toHaveProperty('data')
      expect(Array.isArray(body.data)).toBe(true)
    })
  })

  describe('GET /api/v1/sectors/:slug', () => {
    it('returns 404 for unknown slug', async () => {
      const res = await app.request('/api/v1/sectors/nonexistent')
      expect(res.status).toBe(404)
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun run test:run
```

Expected: FAIL — 404 on `/api/v1/sectors`

- [ ] **Step 3: Create sectors Zod schemas**

Create `src/modules/sectors/sectors.schema.ts`:

```typescript
import { z } from '@hono/zod-openapi'

export const SectorSchema = z.object({
  id: z.number(),
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  schemaName: z.string(),
  createdAt: z.string(),
})

export const SectorsResponseSchema = z.object({
  data: z.array(SectorSchema),
})

export const SectorResponseSchema = z.object({
  data: SectorSchema,
})
```

- [ ] **Step 4: Create sectors service**

Create `src/modules/sectors/sectors.service.ts`:

```typescript
import { db } from '@/db/client'
import { sectors } from '@/db/schema'
import { eq } from 'drizzle-orm'

export async function getAllSectors() {
  return db.select().from(sectors)
}

export async function getSectorBySlug(slug: string) {
  const result = await db.select().from(sectors).where(eq(sectors.slug, slug))
  return result[0] ?? null
}
```

- [ ] **Step 5: Create sectors routes**

Create `src/modules/sectors/sectors.routes.ts`:

```typescript
import { OpenAPIHono, createRoute } from '@hono/zod-openapi'
import { z } from 'zod'
import { SectorsResponseSchema, SectorResponseSchema } from './sectors.schema'
import { getAllSectors, getSectorBySlug } from './sectors.service'
import { notFound } from '@/shared/errors'

export const sectorsApp = new OpenAPIHono()

const listRoute = createRoute({
  method: 'get',
  path: '/api/v1/sectors',
  tags: ['Sectors'],
  responses: {
    200: {
      content: { 'application/json': { schema: SectorsResponseSchema } },
      description: 'List of all sectors',
    },
  },
})

const getRoute = createRoute({
  method: 'get',
  path: '/api/v1/sectors/{slug}',
  tags: ['Sectors'],
  request: {
    params: z.object({ slug: z.string() }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: SectorResponseSchema } },
      description: 'Sector details',
    },
    404: {
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
      description: 'Sector not found',
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
```

- [ ] **Step 6: Mount sectors in app.ts**

Update `src/app.ts` — add after healthApp import:

```typescript
import { sectorsApp } from './modules/sectors/sectors.routes'
```

Add after `app.route('/', healthApp)`:

```typescript
app.route('/', sectorsApp)
```

- [ ] **Step 7: Run tests**

```bash
bun run test:run
```

Expected: PASS (requires database running with seed data)

- [ ] **Step 8: Commit**

```bash
git add src/modules/sectors/ tests/sectors.test.ts src/app.ts
git commit -m "feat: add sectors endpoints"
```

---

### Task 7: Categories Module

**Files:**
- Create: `src/modules/categories/categories.schema.ts`
- Create: `src/modules/categories/categories.service.ts`
- Create: `src/modules/categories/categories.routes.ts`
- Create: `tests/categories.test.ts`

- [ ] **Step 1: Write the categories test**

Create `tests/categories.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { app } from '../src/app'

describe('Categories', () => {
  describe('GET /api/v1/sectors/:slug/categories', () => {
    it('returns 404 for unknown sector', async () => {
      const res = await app.request('/api/v1/sectors/nonexistent/categories')
      expect(res.status).toBe(404)
    })

    it('returns 200 with array for valid sector', async () => {
      const res = await app.request('/api/v1/sectors/civil-construction/categories')
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toHaveProperty('data')
      expect(Array.isArray(body.data)).toBe(true)
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun run test:run
```

Expected: FAIL

- [ ] **Step 3: Create categories Zod schemas**

Create `src/modules/categories/categories.schema.ts`:

```typescript
import { z } from '@hono/zod-openapi'

export const CategorySchema = z.object({
  id: z.number(),
  slug: z.string(),
  name: z.string(),
  createdAt: z.string(),
})

export const CategoriesResponseSchema = z.object({
  data: z.array(CategorySchema),
})
```

- [ ] **Step 4: Create categories service**

Create `src/modules/categories/categories.service.ts`:

```typescript
import { db } from '@/db/client'
import { civilConstructionCategories } from '@/db/schema'

export async function getCategoriesBySector(schemaName: string) {
  // For now, only civil_construction has categories
  // As more sectors are added, this will dynamically route to the correct schema
  if (schemaName === 'civil_construction') {
    return db.select().from(civilConstructionCategories)
  }
  return []
}
```

- [ ] **Step 5: Create categories routes**

Create `src/modules/categories/categories.routes.ts`:

```typescript
import { OpenAPIHono, createRoute } from '@hono/zod-openapi'
import { z } from 'zod'
import { CategoriesResponseSchema } from './categories.schema'
import { getCategoriesBySector } from './categories.service'
import { getSectorBySlug } from '@/modules/sectors/sectors.service'
import { notFound } from '@/shared/errors'

export const categoriesApp = new OpenAPIHono()

const listRoute = createRoute({
  method: 'get',
  path: '/api/v1/sectors/{slug}/categories',
  tags: ['Categories'],
  request: {
    params: z.object({ slug: z.string() }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: CategoriesResponseSchema } },
      description: 'List of categories for the sector',
    },
    404: {
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
      description: 'Sector not found',
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
```

- [ ] **Step 6: Mount categories in app.ts**

Update `src/app.ts` — add import:

```typescript
import { categoriesApp } from './modules/categories/categories.routes'
```

Add route:

```typescript
app.route('/', categoriesApp)
```

- [ ] **Step 7: Run tests**

```bash
bun run test:run
```

Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/modules/categories/ tests/categories.test.ts src/app.ts
git commit -m "feat: add categories endpoints"
```

---

### Task 8: Items Module

**Files:**
- Create: `src/modules/items/items.schema.ts`
- Create: `src/modules/items/items.service.ts`
- Create: `src/modules/items/items.routes.ts`
- Create: `tests/items.test.ts`

- [ ] **Step 1: Write the items tests**

Create `tests/items.test.ts`:

```typescript
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
      const res = await app.request('/api/v1/sectors/civil-construction/items?q=acetileno')
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.data.length).toBeGreaterThan(0)
      expect(body.data[0].description.toLowerCase()).toContain('acetileno')
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
      const res = await app.request('/api/v1/sectors/civil-construction/items/1')
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.data.code).toBe(1)
    })

    it('returns 404 for unknown code', async () => {
      const res = await app.request('/api/v1/sectors/civil-construction/items/999999')
      expect(res.status).toBe(404)
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun run test:run
```

Expected: FAIL

- [ ] **Step 3: Create items Zod schemas**

Create `src/modules/items/items.schema.ts`:

```typescript
import { z } from '@hono/zod-openapi'
import { paginationQuerySchema } from '@/shared/pagination'

export const ItemSchema = z.object({
  id: z.number(),
  code: z.number(),
  description: z.string(),
  unit: z.string(),
  technicalStandards: z.string().nullable(),
  generalInfo: z.string().nullable(),
  imageUrl: z.string().nullable(),
  metadata: z.any().nullable(),
  sourceUpdatedAt: z.string().nullable(),
  createdAt: z.string(),
})

export const ItemsQuerySchema = paginationQuerySchema.extend({
  q: z.string().optional(),
  unit: z.string().optional(),
})

export const PaginationMetaSchema = z.object({
  total: z.number(),
  page: z.number(),
  limit: z.number(),
  totalPages: z.number(),
})

export const ItemsResponseSchema = z.object({
  data: z.array(ItemSchema),
  meta: PaginationMetaSchema,
})

export const ItemResponseSchema = z.object({
  data: ItemSchema,
})
```

- [ ] **Step 4: Create items service**

Create `src/modules/items/items.service.ts`:

```typescript
import { db } from '@/db/client'
import { civilConstructionItems } from '@/db/schema'
import { eq, sql, and, count } from 'drizzle-orm'
import type { PaginationQuery } from '@/shared/pagination'

interface ItemsFilter extends PaginationQuery {
  q?: string
  unit?: string
}

export async function getItems(schemaName: string, filter: ItemsFilter) {
  if (schemaName !== 'civil_construction') {
    return { items: [], total: 0 }
  }

  const table = civilConstructionItems
  const conditions = []

  if (filter.unit) {
    conditions.push(eq(table.unit, filter.unit))
  }

  if (filter.q) {
    conditions.push(
      sql`to_tsvector('portuguese', ${table.description} || ' ' || coalesce(${table.generalInfo}, '')) @@ plainto_tsquery('portuguese', ${filter.q})`
    )
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined
  const offset = (filter.page - 1) * filter.limit

  const [items, totalResult] = await Promise.all([
    db.select()
      .from(table)
      .where(where)
      .limit(filter.limit)
      .offset(offset)
      .orderBy(table.code),
    db.select({ total: count() })
      .from(table)
      .where(where),
  ])

  return { items, total: totalResult[0].total }
}

export async function getItemByCode(schemaName: string, code: number) {
  if (schemaName !== 'civil_construction') {
    return null
  }

  const result = await db.select()
    .from(civilConstructionItems)
    .where(eq(civilConstructionItems.code, code))

  return result[0] ?? null
}
```

- [ ] **Step 5: Create items routes**

Create `src/modules/items/items.routes.ts`:

```typescript
import { OpenAPIHono, createRoute } from '@hono/zod-openapi'
import { z } from 'zod'
import { ItemsResponseSchema, ItemResponseSchema, ItemsQuerySchema } from './items.schema'
import { getItems, getItemByCode } from './items.service'
import { getSectorBySlug } from '@/modules/sectors/sectors.service'
import { notFound } from '@/shared/errors'
import { paginationMeta } from '@/shared/pagination'

export const itemsApp = new OpenAPIHono()

const listRoute = createRoute({
  method: 'get',
  path: '/api/v1/sectors/{slug}/items',
  tags: ['Items'],
  request: {
    params: z.object({ slug: z.string() }),
    query: ItemsQuerySchema,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: ItemsResponseSchema } },
      description: 'Paginated list of items with optional search and filters',
    },
    404: {
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
      description: 'Sector not found',
    },
  },
})

const getRoute = createRoute({
  method: 'get',
  path: '/api/v1/sectors/{slug}/items/{code}',
  tags: ['Items'],
  request: {
    params: z.object({
      slug: z.string(),
      code: z.coerce.number(),
    }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: ItemResponseSchema } },
      description: 'Item details',
    },
    404: {
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
      description: 'Item or sector not found',
    },
  },
})

itemsApp.openapi(listRoute, async (c) => {
  const { slug } = c.req.valid('param')
  const query = c.req.valid('query')

  const sector = await getSectorBySlug(slug)
  if (!sector) return notFound(c, 'Sector not found')

  const { items, total } = await getItems(sector.schemaName, query)
  const meta = paginationMeta(total, query.page, query.limit)

  return c.json({ data: items, meta }, 200)
})

itemsApp.openapi(getRoute, async (c) => {
  const { slug, code } = c.req.valid('param')

  const sector = await getSectorBySlug(slug)
  if (!sector) return notFound(c, 'Sector not found')

  const item = await getItemByCode(sector.schemaName, code)
  if (!item) return notFound(c, 'Item not found')

  return c.json({ data: item }, 200)
})
```

- [ ] **Step 6: Mount items in app.ts**

Update `src/app.ts` — add import:

```typescript
import { itemsApp } from './modules/items/items.routes'
```

Add route:

```typescript
app.route('/', itemsApp)
```

- [ ] **Step 7: Run tests**

```bash
bun run test:run
```

Expected: ALL PASS

- [ ] **Step 8: Commit**

```bash
git add src/modules/items/ tests/items.test.ts src/app.ts
git commit -m "feat: add items endpoints with full-text search and pagination"
```

---

### Task 9: Dockerfile + README

**Files:**
- Create: `Dockerfile`
- Create: `README.md`

- [ ] **Step 1: Create Dockerfile**

```dockerfile
FROM oven/bun:1 AS base
WORKDIR /app

FROM base AS install
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM base AS release
COPY --from=install /app/node_modules ./node_modules
COPY src/ ./src/
COPY drizzle/ ./drizzle/
COPY package.json drizzle.config.ts tsconfig.json ./

ENV NODE_ENV=production
EXPOSE 3000

CMD ["bun", "run", "src/index.ts"]
```

- [ ] **Step 2: Create README.md**

```markdown
# sinpres-api

API pública do **SINPRES — Sistema Nacional de Preços Setoriais**.

Consulta de preços e insumos por setor da economia brasileira.

## Setores

| Setor | Schema | Status |
|---|---|---|
| Construção Civil (SINAPI) | `civil_construction` | Disponível |
| Saúde | `health` | Em breve |
| Alimentação | `food` | Em breve |
| Energia | `energy` | Em breve |

## Stack

- **Runtime:** Bun
- **Framework:** Hono + OpenAPI
- **Database:** PostgreSQL (schemas isolados por setor)
- **ORM:** Drizzle
- **Docs:** Scalar

## Endpoints

```
GET /health
GET /reference                              → Documentação interativa (Scalar)

GET /api/v1/sectors
GET /api/v1/sectors/:slug

GET /api/v1/sectors/:slug/categories

GET /api/v1/sectors/:slug/items?q=&unit=&page=&limit=
GET /api/v1/sectors/:slug/items/:code
```

## Setup

```bash
# Dependências
bun install

# Banco de dados
docker compose up -d
bun run db:generate
bun run db:migrate

# Seed (requer output do sinapi-extractor)
bun run src/db/seed/seed.ts path/to/items.json

# Dev
bun run dev
```

## Documentação

Acesse `/reference` para a documentação interativa da API.

## Mantido por

[TREE.IA](https://tree.ia.br)

## Licença

MIT
```

- [ ] **Step 3: Commit**

```bash
git add Dockerfile README.md
git commit -m "docs: add Dockerfile and README"
```

---

## Self-Review

**Spec coverage:** All endpoints defined (health, sectors, categories, items with search/filter/pagination). Isolated PostgreSQL schemas per sector. OpenAPI auto-generation. Scalar docs UI. Docker support.

**Placeholder scan:** No TBDs, TODOs, or vague steps. All code blocks are complete.

**Type consistency:** `ItemSchema`, `SectorSchema`, `CategorySchema` field names match Drizzle schema column names (camelCase via Drizzle mapping). Service functions return types consistent with what routes expect. `paginationMeta` signature matches usage in items routes.

---

Plan complete and saved to `docs/superpowers/plans/2026-03-26-sinpres-api.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?