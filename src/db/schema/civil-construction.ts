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
