/**
 * SINAPI Maintenances importer — populates previous_code in the catalogs.
 *
 * When a code is substituted (e.g., input 11616 replaced by 11281), this importer records
 * the mapping so API consumers can detect migrations via the `previousCode` field in
 * responses and update their local records accordingly.
 *
 * Supported inputs:
 *   - .json  Explicit substitution list (shape below). This is the canonical format
 *            because the Caixa XLSX does not carry a structured old -> new mapping.
 *              [
 *                { "old_code": 11616, "new_code": 11281, "type": "INPUT" },
 *                { "old_code": 95261, "new_code": 95262, "type": "COMPOSITION" }
 *              ]
 *   - .xlsx  The official Caixa "Relatório de Manutenções" published alongside the
 *            monthly SINAPI bundle (file `SINAPI_Manutenções_YYYY_MM.xlsx`). The XLSX
 *            lists events per code (CRIAÇÃO, DESATIVAÇÃO, ALTERAÇÃO DE DESCRIÇÃO, etc.)
 *            but does NOT include a column pairing the replaced and the replacement code.
 *            The XLSX parser therefore counts each maintenance type for reporting and
 *            only emits substitution entries when the row carries both old_code and
 *            new_code. Under the current Caixa format that count is always zero and the
 *            full substitution list must be provided via the .json input.
 *
 * Usage:
 *   bun run src/db/import/maintenances.ts path/to/maintenances.json
 *   bun run src/db/import/maintenances.ts path/to/SINAPI_Manutenções_YYYY_MM.xlsx
 */
import * as XLSX from 'xlsx'
import { db } from '../client'
import { itemCatalog, compositionCatalog } from '../schema/civil-construction'
import { eq, sql } from 'drizzle-orm'
import { readFileSync } from 'fs'
import { extname, resolve } from 'path'

export type MaintenanceType = 'INPUT' | 'COMPOSITION'

export interface MaintenanceEntry {
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

export function parseJsonMaintenances(filePath: string): MaintenanceEntry[] {
  const raw = readFileSync(filePath, 'utf-8')
  const parsed: unknown = JSON.parse(raw)
  if (!Array.isArray(parsed)) {
    throw new Error('Input JSON must be an array of maintenance entries.')
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
  return entries
}

function normalizeHeader(val: unknown): string {
  if (val === null || val === undefined) return ''
  return String(val)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\r?\n/g, ' ')
    .replace(/[^A-Z0-9\s]/g, ' ')
    .trim()
    .replace(/\s+/g, '_')
}

function findHeaderRow(rows: unknown[][], keywords: string[]): number {
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const normalized = rows[i].map(normalizeHeader).join('_')
    if (keywords.every((k) => normalized.includes(k))) {
      return i
    }
  }
  return -1
}

/**
 * Parses the official "Relatório de Manutenções" XLSX.
 *
 * Sheet layout (as of 2026-03):
 *   Row 0: title
 *   Row 1: "RELATÓRIO DE MANUTENÇÕES DE INSUMOS E COMPOSIÇÕES"
 *   Row 2: "Mês de Referência:" | "MM/YYYY"
 *   Row 3: "Data de emissão:"   | "DD/MM/YYYY"
 *   Row 4: (blank)
 *   Row 5: headers -> Referência | Tipo | Código | Descrição | Manutenção
 *   Rows 6..: data
 *
 * Only rows whose "Manutenção" text contains both an old and new code (see
 * parseSubstitutionFromManutencao) yield a MaintenanceEntry. Everything else is counted
 * per-type and reported in the summary. In the current Caixa format no row carries that
 * mapping, so this function typically returns an empty array — use the .json input to
 * load substitutions.
 */
export function parseMaintenancesXlsx(filePath: string): MaintenanceEntry[] {
  const workbook = XLSX.readFile(filePath)
  const sheetName =
    workbook.SheetNames.find((n) => normalizeHeader(n).includes('MANUTEN')) ??
    workbook.SheetNames[0]
  if (!sheetName) {
    console.warn('  No sheet found in XLSX')
    return []
  }

  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1 }) as unknown[][]
  if (rows.length < 2) return []

  const headerRow = findHeaderRow(rows, ['TIPO', 'CODIGO', 'MANUTENCAO'])
  if (headerRow === -1) {
    console.warn('  Header row not found — expected columns Tipo, Código, Manutenção')
    return []
  }

  const headers = rows[headerRow].map(normalizeHeader)
  const tipoIdx = headers.findIndex((h) => h === 'TIPO')
  const codigoIdx = headers.findIndex((h) => h === 'CODIGO')
  const manutencaoIdx = headers.findIndex((h) => h === 'MANUTENCAO')
  const descricaoIdx = headers.findIndex((h) => h === 'DESCRICAO')

  if (tipoIdx === -1 || codigoIdx === -1 || manutencaoIdx === -1) {
    console.warn('  Required columns (Tipo, Código, Manutenção) not found')
    return []
  }

  const entries: MaintenanceEntry[] = []
  const typeCounts = new Map<string, number>()
  let totalRows = 0

  for (let i = headerRow + 1; i < rows.length; i++) {
    const row = rows[i]
    if (!row || !row[codigoIdx]) continue

    const rawTipo = String(row[tipoIdx] ?? '').trim().toUpperCase()
    const rawCodigo = Number(row[codigoIdx])
    if (isNaN(rawCodigo) || rawCodigo === 0) continue

    const manutencao = String(row[manutencaoIdx] ?? '').trim()
    const descricao = descricaoIdx !== -1 ? String(row[descricaoIdx] ?? '').trim() : ''

    totalRows++
    typeCounts.set(manutencao, (typeCounts.get(manutencao) ?? 0) + 1)

    const type: MaintenanceType | null = rawTipo.includes('COMPOSICAO')
      ? 'COMPOSITION'
      : rawTipo.includes('INSUMO')
        ? 'INPUT'
        : null
    if (!type) continue

    const pair = parseSubstitutionFromManutencao(manutencao, descricao)
    if (pair) {
      entries.push({
        old_code: pair.oldCode,
        new_code: pair.newCode,
        type,
      })
    }
  }

  console.log(`  -> ${totalRows} data rows parsed; ${entries.length} substitution entries extracted`)
  console.log('  Maintenance type breakdown (skipped — not substitutions):')
  for (const [t, c] of [...typeCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(c).padStart(6)}  ${t}`)
  }

  return entries
}

/**
 * Best-effort extraction of (old_code, new_code) from a "Manutenção" cell. In the current
 * Caixa format there is no structured field carrying the mapping, so we look for common
 * free-text patterns. Returns null whenever we cannot confidently recover both codes.
 */
function parseSubstitutionFromManutencao(
  manutencao: string,
  _descricao: string
): { oldCode: number; newCode: number } | null {
  const text = manutencao.toUpperCase()
  // Patterns like "SUBSTITUÍDO PELO CÓDIGO 12345" or "NOVO CÓDIGO: 12345". In practice
  // the Caixa XLSX never carries this — the function is kept as a forward-compatible
  // hook in case the format changes.
  const match = text.match(/(?:SUBSTITU[IÍ]D[OA] (?:PEL[OA] )?(?:NOVO )?C[OÓ]DIGO|NOVO C[OÓ]DIGO|C[OÓ]DIGO SUBSTITUTO)\s*:?\s*(\d{2,6})/)
  if (!match) return null
  const newCode = Number(match[1])
  // Without the old_code paired in the same cell we cannot emit an entry.
  return { oldCode: 0, newCode }
}

async function applyEntries(entries: MaintenanceEntry[]) {
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
}

export async function runMaintenancesImport(filePath: string) {
  const absolutePath = resolve(filePath)
  const ext = extname(absolutePath).toLowerCase()
  console.log(`Reading maintenances from: ${absolutePath}`)

  let entries: MaintenanceEntry[]
  if (ext === '.json') {
    entries = parseJsonMaintenances(absolutePath)
  } else if (ext === '.xlsx' || ext === '.xls') {
    entries = parseMaintenancesXlsx(absolutePath)
  } else {
    throw new Error(`Unsupported file extension: ${ext}. Use .json or .xlsx.`)
  }

  await applyEntries(entries)
}

async function main() {
  const inputPath = process.argv[2]
  if (!inputPath) {
    console.error('Usage: bun run src/db/import/maintenances.ts <path-to-file>')
    console.error('')
    console.error('Supported formats:')
    console.error('  .json  Array of { old_code, new_code, type: "INPUT" | "COMPOSITION" }')
    console.error('  .xlsx  Caixa "Relatório de Manutenções" (SINAPI_Manutenções_YYYY_MM.xlsx)')
    process.exit(1)
  }

  await runMaintenancesImport(inputPath)
  process.exit(0)
}

// Only run main when this file is executed directly, not when imported.
if (import.meta.main) {
  main().catch((err) => {
    console.error('Maintenances import failed:', err)
    process.exit(1)
  })
}
