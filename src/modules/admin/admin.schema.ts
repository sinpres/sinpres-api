import { z } from 'zod'

export const LoginBodySchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(128),
})

export const LoginResponseSchema = z.object({
  user: z.object({
    id: z.number(),
    email: z.string(),
  }),
})

export const ClientSchema = z.object({
  id: z.number(),
  name: z.string(),
  keyPrefix: z.string(),
  scopes: z.array(z.string()),
  rateLimitPerUser: z.number(),
  rateLimitGlobal: z.number().nullable(),
  active: z.boolean(),
  createdAt: z.string(),
  revokedAt: z.string().nullable(),
})

export const ClientsListSchema = z.object({
  data: z.array(ClientSchema),
})

// Issuable scopes offered by the admin panel. read:prices has no gated route yet
// but is still a valid scope to grant.
export const API_SCOPES = ['read:items', 'read:compositions', 'read:prices'] as const

export const CreateClientBodySchema = z.object({
  name: z.string().min(1).max(120),
  scopes: z.array(z.enum(API_SCOPES)).default([]),
  rateLimitPerUser: z.number().int().positive().max(100000).default(300),
  rateLimitGlobal: z.number().int().positive().max(1000000).nullable().optional(),
})

export const CreateClientResponseSchema = z.object({
  client: ClientSchema,
  // Raw API key — returned only here, at creation.
  apiKey: z.string(),
})

export const ErrorSchema = z.object({ error: z.string() })
export const RateLimitErrorSchema = z.object({ error: z.string(), retry_after: z.number() })

export type ClientDTO = z.infer<typeof ClientSchema>
