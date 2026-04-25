/**
 * SINAPI Maintenances importer — populates previous_code in the catalogs.
 *
 * When Caixa publishes a code substitution (e.g., input 11616 replaced by 11281), this
 * importer records the mapping so API consumers can detect migrations via the
 * `previousCode` field in responses and update their local records accordingly.
 *
 * Input (current): JSON file with the structure below.
 *   [
 *     { "old_code": 11616, "new_code": 11281, "type": "INPUT" },
 *     { "old_code": 95261, "new_code": 95262, "type": "COMPOSITION" }
 *   ]
 *
 * TODO: add an XLSX parser for the official "Relatório de Manutenções" published by
 *       Caixa alongside the monthly SINAPI bundle (file `SINAPI_Manutenções_YYYY_MM.xlsx`).
 *       When implemented, switch on file extension at the top of main().
 *
 * Usage:
 *   bun run src/db/import/maintenances.ts path/to/maintenances.json
 */
import { db } from '../client'
import { itemCatalog, compositionCatalog } from '../schema/civil-construction'
import { eq, sql } from 'drizzle-orm'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const INPUT_PATH = process.argv[2]

if (!INPUT_PATH) {
  console.error('Usage: bun run src/db/import/maintenances.ts <path-to-maintenances.json>')
  console.error('')
  console.error('Expected JSON shape:')
  console.error(
    JSON.stringify(
      [
        { old_code: 11616, new_code: 11281, type: 'INPUT' },
        { old_code: 95261, new_code: 95262, type: 'COMPOSITION' },
      ],
      null,
      2
    )
  )
  process.exit(1)
}

type MaintenanceType = 'INPUT' | 'COMPOSITION'

interface MaintenanceEntry {
  old_code: number
  new_code: number
  type: MaintenanceType
}

function isValidEntry(e: unknown): e is MaintenanceEntry {
  if (typeof e !== 'object' || e === null) return false
  const obj = e as Record<string, unknown>
  return (
    typeof obj.old_code === 'number' &&
    typeof obj.new_code === 'number' &&
    (obj.type === 'INPUT' || obj.type === 'COMPOSITION')
  )
}

async function main() {
  const filePath = resolve(INPUT_PATH)
  console.log(`Reading maintenances from: ${filePath}`)

  const raw = readFileSync(filePath, 'utf-8')
  const parsed = JSON.parse(raw)
  if (!Array.isArray(parsed)) {
    console.error('Input JSON must be an array of maintenance entries.')
    process.exit(1)
  }

  const entries: MaintenanceEntry[] = []
  let invalid = 0
  for (const e of parsed) {
    if (isValidEntry(e)) {
      entries.push(e)
    } else {
      invalid++
    }
  }

  console.log(`  -> ${entries.length} valid entries (${invalid} invalid, skipped)`)

  let inputsApplied = 0
  let inputsNotFound = 0
  let compsApplied = 0
  let compsNotFound = 0

  for (const entry of entries) {
    if (entry.type === 'INPUT') {
      const result = await db
        .update(itemCatalog)
        .set({ previousCode: entry.old_code, updatedAt: sql`NOW()` })
        .where(eq(itemCatalog.code, entry.new_code))
        .returning({ id: itemCatalog.id })
      if (result.length === 0) {
        inputsNotFound++
        console.warn(`[maintenances] INPUT new_code=${entry.new_code} not found in item_catalog`)
      } else {
        inputsApplied++
      }
    } else {
      const result = await db
        .update(compositionCatalog)
        .set({ previousCode: entry.old_code, updatedAt: sql`NOW()` })
        .where(eq(compositionCatalog.code, entry.new_code))
        .returning({ id: compositionCatalog.id })
      if (result.length === 0) {
        compsNotFound++
        console.warn(
          `[maintenances] COMPOSITION new_code=${entry.new_code} not found in composition_catalog`
        )
      } else {
        compsApplied++
      }
    }
  }

  console.log('')
  console.log('=== Maintenances import complete ===')
  console.log(`  Inputs:       ${inputsApplied} applied, ${inputsNotFound} not found`)
  console.log(`  Compositions: ${compsApplied} applied, ${compsNotFound} not found`)
  process.exit(0)
}

main().catch((err) => {
  console.error('Maintenances import failed:', err)
  process.exit(1)
})
