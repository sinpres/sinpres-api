import { boolean, integer, pgTable, serial, text, timestamp, varchar } from 'drizzle-orm/pg-core'

export const sectors = pgTable('sectors', {
  id: serial('id').primaryKey(),
  slug: varchar('slug', { length: 100 }).notNull().unique(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  schemaName: varchar('schema_name', { length: 100 }).notNull().unique(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// Internal operators who can sign in to the admin panel. Accounts are created
// out-of-band (db:seed:admin) — there is no self-service signup.
export const adminUsers = pgTable('admin_users', {
  id: serial('id').primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// API keys issued to internal products (e.g. Meu Construtor). The raw key is
// shown once at creation; only its sha256 hash is stored.
export const integrationClients = pgTable('integration_clients', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 120 }).notNull(),
  keyPrefix: varchar('key_prefix', { length: 32 }).notNull(),
  keyHash: varchar('key_hash', { length: 64 }).notNull().unique(),
  scopes: text('scopes').array().notNull().default([]),
  rateLimitPerUser: integer('rate_limit_per_user').notNull().default(300),
  rateLimitGlobal: integer('rate_limit_global'),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  revokedAt: timestamp('revoked_at'),
})
