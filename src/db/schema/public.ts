import { pgTable, serial, text, timestamp, varchar } from 'drizzle-orm/pg-core'

export const sectors = pgTable('sectors', {
  id: serial('id').primaryKey(),
  slug: varchar('slug', { length: 100 }).notNull().unique(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  schemaName: varchar('schema_name', { length: 100 }).notNull().unique(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})
