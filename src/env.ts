import { existsSync, readFileSync } from 'node:fs'
import { z } from 'zod'

function loadLocalEnvFile(filePath: string) {
  if (process.env.NODE_ENV === 'production' || !existsSync(filePath)) return

  const content = readFileSync(filePath, 'utf-8')
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const eqIndex = trimmed.indexOf('=')
    if (eqIndex === -1) continue

    const key = trimmed.slice(0, eqIndex).trim()
    const value = trimmed.slice(eqIndex + 1).trim()
    process.env[key] ??= value
  }
}

loadLocalEnvFile('.env')
loadLocalEnvFile('.env.local')

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  POSTGRES_POOL_MAX: z.coerce.number().int().min(1).max(50).default(5),
  POSTGRES_IDLE_TIMEOUT_SECONDS: z.coerce.number().int().min(1).max(300).default(5),
  POSTGRES_CONNECT_TIMEOUT_SECONDS: z.coerce.number().int().min(1).max(60).default(10),
  POSTGRES_MAX_LIFETIME_SECONDS: z.coerce.number().int().min(60).max(3600).default(1800),
  POSTGRES_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(10000),
  UPSTASH_REDIS_REST_URL: z.string().min(1).optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1).optional(),
  // Shared secret the web panel presents (Bearer) to reach /admin/clients.
  ADMIN_API_SECRET: z.string().min(32).optional(),
}).superRefine((value, ctx) => {
  if (value.NODE_ENV !== 'production') return

  if (!value.UPSTASH_REDIS_REST_URL) {
    ctx.addIssue({
      code: 'custom',
      path: ['UPSTASH_REDIS_REST_URL'],
      message: 'Required in production',
    })
  }

  if (!value.UPSTASH_REDIS_REST_TOKEN) {
    ctx.addIssue({
      code: 'custom',
      path: ['UPSTASH_REDIS_REST_TOKEN'],
      message: 'Required in production',
    })
  }

  if (!value.ADMIN_API_SECRET) {
    ctx.addIssue({
      code: 'custom',
      path: ['ADMIN_API_SECRET'],
      message: 'Required in production',
    })
  }
})

export const env = envSchema.parse(process.env)
