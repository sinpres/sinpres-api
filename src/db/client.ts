import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { env } from '../env'
import * as schema from './schema'

const client = postgres(env.DATABASE_URL, {
  prepare: false,
  max: env.POSTGRES_POOL_MAX,
  idle_timeout: env.POSTGRES_IDLE_TIMEOUT_SECONDS,
  connect_timeout: env.POSTGRES_CONNECT_TIMEOUT_SECONDS,
  max_lifetime: env.POSTGRES_MAX_LIFETIME_SECONDS,
  connection: {
    application_name: 'sinpres-api',
    statement_timeout: env.POSTGRES_STATEMENT_TIMEOUT_MS,
  },
})
export const db = drizzle(client, { schema })
export type Database = typeof db
