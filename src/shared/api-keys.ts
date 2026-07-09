import { createHash, randomBytes } from 'node:crypto'

export const KEY_PREFIX = 'sinp_live_'
const PREVIEW_LEN = KEY_PREFIX.length + 6

export function hashApiKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

// Malformed keys are rejected without a DB lookup.
export function isValidApiKeyFormat(raw: string): boolean {
  return raw.startsWith(KEY_PREFIX) && raw.length >= 20 && raw.length <= 80
}

// Raw key is shown to the operator exactly once, at creation. The DB only ever
// stores the sha256 hash plus a short prefix for display.
export function generateApiKey() {
  const raw = KEY_PREFIX + randomBytes(32).toString('base64url')
  return {
    raw,
    keyHash: hashApiKey(raw),
    keyPrefix: raw.slice(0, PREVIEW_LEN),
  }
}
