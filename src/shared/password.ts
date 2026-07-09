import { argon2id, argon2Verify } from 'hash-wasm'
import { randomBytes } from 'node:crypto'

// Argon2id — OWASP 2024 baseline (64 MiB, t=3, p=4). WASM implementation so it
// runs identically under Bun (dev) and Node (Vercel prod) with no native binary.
const ARGON2_OPTIONS = {
  parallelism: 4,
  iterations: 3,
  memorySize: 65536,
  hashLength: 32,
} as const

export async function hashPassword(password: string): Promise<string> {
  const salt = new Uint8Array(randomBytes(16))
  return argon2id({ password, salt, ...ARGON2_OPTIONS, outputType: 'encoded' })
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2Verify({ password, hash })
  } catch {
    return false
  }
}

// Verified in the "account not found" branch so login timing doesn't reveal
// whether an email exists (anti-enumeration). Never authenticates anyone.
let dummyHash: Promise<string> | null = null
export function dummyVerify(password: string): Promise<boolean> {
  dummyHash ??= hashPassword('sinpres-timing-equalization-placeholder')
  return dummyHash.then((hash) => verifyPassword(hash, password))
}
