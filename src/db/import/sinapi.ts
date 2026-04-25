/**
 * SINAPI XLSX importer — writes to the new dimensional tables only.
 *
 * Targets (new):
 *   - civil_construction.item_catalog         (upsert by code, SCD Type 1)
 *   - civil_construction.item_prices          (upsert by (catalog_id, state, month, regime))
 *   - civil_construction.composition_catalog  (upsert by code, SCD Type 1)
 *   - civil_construction.composition_prices   (upsert by (catalog_id, state, month, regime))
 *   - civil_construction.composition_items_v2 (upsert by (composition_id, item_type, item_code))
 *
 * Legacy tables (items, compositions, composition_items) are intentionally NOT written to.
 *
 * Fields NOT populated by this importer:
 *   - previous_code          -> populated by maintenances.ts
 *   - image_url, technical_standards, general_info, source_updated_at
 *                            -> populated by enrich-from-extractor.ts
 *   - resource_type          -> left null (XLSX ISD/ICD does not expose it in a clear column;
 *                               the Analítico "TIPO" is item_type INSUMO/COMPOSICAO, which is
 *                               orthogonal to resource_type MATERIAL/MAO_DE_OBRA/EQUIPAMENTO).
 *
 * On re-runs, description/unit divergences against the current catalog row are logged as
 * WARNINGs before the SCD Type 1 update overwrites the catalog values.
 */
import * as XLSX from 'xlsx'
import { db } from '../client'
import { itemCatalog, itemPrices, compositionCatalog, compositionPrices, compositionItemsV2 } from '../schema/civil-construction'
import { sql } from 'drizzle-orm'
import { resolve } from 'path'

export interface RunSinapiImportArgs {
  referenceMonth: string
  filePath: string
}

function normalizeHeader(val: unknown): string {
  if (val === null || val === undefined) return ''
  return String(val)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
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

function extractUFsFromRow3(row: unknown[]): string[] {
  const ufs: string[] = []
  for (const cell of row) {
    const val = String(cell ?? '').trim().toUpperCase()
    if (/^[A-Z]{2}$/.test(val) && !ufs.includes(val)) {
      ufs.push(val)
    }
  }
  return ufs
}

interface ParsedItem {
  code: number
  description: string
  unit: string
  stateCode: string
  referenceMonth: string
  isDesonerated: boolean
  unitPrice: number
}

interface ParsedComposition {
  code: number
  description: string
  unit: string
  stateCode: string
  referenceMonth: string
  isDesonerated: boolean
  baseUnitCost: number
}

interface ParsedCompositionItem {
  compositionCode: number
  itemType: 'INPUT' | 'SUB_COMPOSITION'
  code: number
  description: string
  unit: string
  coefficient: string
}

function normalizeForCompare(s: string | null | undefined): string {
  return String(s ?? '').trim().toUpperCase()
}

function parseInsumosSheet(
  worksheet: XLSX.WorkSheet,
  referenceMonth: string,
  isDesonerated: boolean
): ParsedItem[] {
  const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as unknown[][]
  if (rows.length < 10) return []

  const ufs = extractUFsFromRow3(rows[3] || [])
  if (ufs.length === 0) {
    console.warn('  No UFs found in row 3')
    return []
  }

  const headerRow = findHeaderRow(rows, ['CODIGO', 'DESCRICAO'])
  if (headerRow === -1) {
    console.warn('  Header not found')
    return []
  }

  const headers = rows[headerRow].map(normalizeHeader)
  const codeIdx = headers.findIndex((h) => h.includes('CODIGO') && h.includes('INSUMO'))
  const descIdx = headers.findIndex((h) => h.includes('DESCRICAO'))
  const unitIdx = headers.findIndex((h) => h.includes('UNIDADE'))

  if (codeIdx === -1 || descIdx === -1) {
    console.warn('  Required columns not found')
    return []
  }

  const ufIndices = ufs
    .map((uf) => ({ uf, idx: headers.indexOf(uf) }))
    .filter((x) => x.idx !== -1)

  const result: ParsedItem[] = []

  for (let i = headerRow + 1; i < rows.length; i++) {
    const row = rows[i]
    if (!row || !row[codeIdx]) continue

    const code = Number(row[codeIdx])
    if (isNaN(code) || code === 0) continue

    const description = String(row[descIdx] ?? '').trim()
    const unit = unitIdx !== -1 ? String(row[unitIdx] ?? '').trim().toUpperCase() : 'UN'

    for (const { uf, idx } of ufIndices) {
      const rawPrice = row[idx]
      if (rawPrice === undefined || rawPrice === null || rawPrice === '') continue
      if (rawPrice === '-') continue

      const price = Math.round(Number(String(rawPrice).replace(',', '.')) * 100)
      if (isNaN(price) || price === 0) continue

      result.push({
        code,
        description,
        unit,
        stateCode: uf,
        referenceMonth,
        isDesonerated,
        unitPrice: price,
      })
    }
  }

  return result
}

function buildCompositionCodeMap(worksheet: XLSX.WorkSheet): Map<string, number> {
  const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as unknown[][]
  if (rows.length < 10) return new Map()

  const headerRow = findHeaderRow(rows, ['CODIGO', 'TIPO'])
  if (headerRow === -1) return new Map()

  const headers = rows[headerRow].map(normalizeHeader)
  const codCompIdx = headers.findIndex((h) => h.includes('CODIGO') && h.includes('COMPOSICAO'))
  const tipoIdx = headers.findIndex((h) => h.includes('TIPO'))
  const descIdx = headers.findIndex((h) => h.includes('DESCRICAO'))

  if (codCompIdx === -1 || tipoIdx === -1 || descIdx === -1) return new Map()

  const map = new Map<string, number>()

  for (let i = headerRow + 1; i < rows.length; i++) {
    const row = rows[i]
    if (!row) continue

    const compCode = row[codCompIdx]
    if (compCode === undefined || compCode === null || compCode === '') continue

    const parsedComp = Number(compCode)
    if (isNaN(parsedComp) || parsedComp === 0) continue

    // Parent rows have empty tipo; child rows have "COMPOSICAO" or "INSUMO"
    const tipo = String(row[tipoIdx] ?? '').trim()
    if (tipo !== '') continue

    const description = String(row[descIdx] ?? '').trim().toUpperCase()
    if (!description) continue

    // Only set if not already present (first occurrence wins for duplicates)
    if (!map.has(description)) {
      map.set(description, parsedComp)
    }
  }

  return map
}

function parseComposicoesSheet(
  worksheet: XLSX.WorkSheet,
  referenceMonth: string,
  isDesonerated: boolean,
  compositionCodeMap: Map<string, number>
): ParsedComposition[] {
  const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as unknown[][]
  if (rows.length < 10) return []

  const ufs = extractUFsFromRow3(rows[3] || [])
  if (ufs.length === 0) {
    console.warn('  No UFs found in row 3')
    return []
  }

  const headerRow = findHeaderRow(rows, ['CODIGO', 'COMPOSICAO'])
  if (headerRow === -1) {
    console.warn('  Header not found')
    return []
  }

  const headers = rows[headerRow].map(normalizeHeader)
  const descIdx = headers.findIndex((h) => h === 'DESCRICAO')
  const unitIdx = headers.findIndex((h) => h.includes('UNIDADE'))

  if (descIdx === -1) {
    console.warn('  Required columns not found')
    return []
  }

  // For compositions, UFs are in pairs: (Custo R$, %AS) for each UF
  const ufCostIndices = ufs
    .map((uf, ufPos) => {
      const costIdx = 4 + ufPos * 2
      return { uf, idx: costIdx }
    })
    .filter((x) => x.idx < headers.length)

  const result: ParsedComposition[] = []
  let matchedCount = 0
  let unmatchedCount = 0

  for (let i = headerRow + 1; i < rows.length; i++) {
    const row = rows[i]
    if (!row || !row[descIdx]) continue

    const description = String(row[descIdx] ?? '').trim()
    const normalizedDesc = description.toUpperCase()
    const code = compositionCodeMap.get(normalizedDesc)

    if (!code) {
      unmatchedCount++
      continue
    }
    matchedCount++

    const unit = unitIdx !== -1 ? String(row[unitIdx] ?? '').trim().toUpperCase() : 'UN'

    for (const { uf, idx } of ufCostIndices) {
      const rawCost = row[idx]
      if (rawCost === undefined || rawCost === null || rawCost === '') continue
      if (rawCost === '-') continue

      const cost = Math.round(Number(String(rawCost).replace(',', '.')) * 100)
      if (isNaN(cost) || cost === 0) continue

      result.push({
        code,
        description,
        unit,
        stateCode: uf,
        referenceMonth,
        isDesonerated,
        baseUnitCost: cost,
      })
    }
  }

  console.log(`  Matched ${matchedCount} compositions by description, ${unmatchedCount} unmatched`)
  return result
}

function parseAnaliticoSheet(worksheet: XLSX.WorkSheet): ParsedCompositionItem[] {
  const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as unknown[][]
  if (rows.length < 10) return []

  const headerRow = findHeaderRow(rows, ['CODIGO', 'TIPO'])
  if (headerRow === -1) {
    console.warn('  Header not found in Analítico')
    return []
  }

  const headers = rows[headerRow].map(normalizeHeader)
  const codCompIdx = headers.findIndex((h) => h.includes('CODIGO') && h.includes('COMPOSICAO'))
  const tipoIdx = headers.findIndex((h) => h.includes('TIPO'))
  const codItemIdx = headers.findIndex((h) => h.includes('CODIGO') && h.includes('ITEM'))
  const descIdx = headers.findIndex((h) => h.includes('DESCRICAO'))
  const unitIdx = headers.findIndex((h) => h.includes('UNIDADE'))
  const coefIdx = headers.findIndex((h) => h.includes('COEFICIENTE'))

  if (codCompIdx === -1 || tipoIdx === -1 || codItemIdx === -1 || coefIdx === -1) {
    console.warn('  Required columns not found in Analítico')
    return []
  }

  const result: ParsedCompositionItem[] = []
  let currentCompositionCode: number | null = null

  for (let i = headerRow + 1; i < rows.length; i++) {
    const row = rows[i]
    if (!row) continue

    // Check if this row defines a parent composition
    const compCode = row[codCompIdx]
    if (compCode !== undefined && compCode !== null && compCode !== '') {
      const parsedComp = Number(compCode)
      if (!isNaN(parsedComp) && parsedComp !== 0) {
        currentCompositionCode = parsedComp
      }
    }

    if (currentCompositionCode === null) continue

    const tipo = String(row[tipoIdx] ?? '').trim().toUpperCase()
    if (!tipo || (!tipo.includes('INSUMO') && !tipo.includes('COMPOSICAO'))) continue

    const itemCode = Number(row[codItemIdx])
    if (isNaN(itemCode) || itemCode === 0) continue

    const description = descIdx !== -1 ? String(row[descIdx] ?? '').trim() : ''
    const unit = unitIdx !== -1 ? String(row[unitIdx] ?? '').trim().toUpperCase() : 'UN'
    const coefficient = String(row[coefIdx] ?? '').replace(',', '.')

    result.push({
      compositionCode: currentCompositionCode,
      itemType: tipo.includes('COMPOSICAO') ? 'SUB_COMPOSITION' : 'INPUT',
      code: itemCode,
      description,
      unit,
      coefficient,
    })
  }

  return result
}

async function runInBatches<T>(
  data: T[],
  batchSize: number,
  label: string,
  runner: (batch: T[]) => Promise<void>
) {
  for (let i = 0; i < data.length; i += batchSize) {
    const batch = data.slice(i, i + batchSize)
    await runner(batch)
    console.log(`  ${label}: ${Math.min(i + batchSize, data.length)}/${data.length}`)
  }
}

interface CatalogStats {
  newCodes: number
  unchanged: number
  divergent: number
  divergenceSamples: number
}

interface PricesStats {
  inserted: number
}

async function upsertItemCatalog(parsedItems: ParsedItem[]): Promise<CatalogStats> {
  const stats: CatalogStats = { newCodes: 0, unchanged: 0, divergent: 0, divergenceSamples: 0 }
  const MAX_DIVERGENCE_SAMPLES = 20

  // Dedup by code — description/unit are stable across UFs/regimes per code
  const byCode = new Map<number, { description: string; unit: string }>()
  for (const p of parsedItems) {
    if (!byCode.has(p.code)) {
      byCode.set(p.code, { description: p.description, unit: p.unit })
    }
  }

  const uniqueCodes = [...byCode.keys()]
  if (uniqueCodes.length === 0) return stats

  console.log(`  Upserting ${uniqueCodes.length} unique item codes...`)

  // Pre-fetch current catalog rows for these codes to classify divergence
  const currentRows = await db
    .select({ code: itemCatalog.code, description: itemCatalog.description, unit: itemCatalog.unit })
    .from(itemCatalog)
    .where(sql`${itemCatalog.code} IN ${uniqueCodes}`)

  const currentMap = new Map(currentRows.map((r) => [r.code, { description: r.description, unit: r.unit }]))

  for (const [code, incoming] of byCode) {
    const existing = currentMap.get(code)
    if (!existing) {
      stats.newCodes++
      continue
    }
    const descDiff = normalizeForCompare(existing.description) !== normalizeForCompare(incoming.description)
    const unitDiff = normalizeForCompare(existing.unit) !== normalizeForCompare(incoming.unit)
    if (descDiff || unitDiff) {
      stats.divergent++
      if (stats.divergenceSamples < MAX_DIVERGENCE_SAMPLES) {
        if (descDiff) {
          console.warn(
            `[divergence] item_code=${code} description: "${existing.description}" -> "${incoming.description}"`
          )
        }
        if (unitDiff) {
          console.warn(`[divergence] item_code=${code} unit: "${existing.unit}" -> "${incoming.unit}"`)
        }
        stats.divergenceSamples++
      }
    } else {
      stats.unchanged++
    }
  }

  const rows = [...byCode.entries()].map(([code, v]) => ({
    code,
    description: v.description,
    unit: v.unit,
  }))

  await runInBatches(rows, 500, 'item_catalog upsert', async (batch) => {
    await db
      .insert(itemCatalog)
      .values(batch as any)
      .onConflictDoUpdate({
        target: itemCatalog.code,
        set: {
          description: sql`EXCLUDED.description`,
          unit: sql`EXCLUDED.unit`,
          updatedAt: sql`NOW()`,
        },
      })
  })

  return stats
}

async function insertItemPrices(parsedItems: ParsedItem[]): Promise<PricesStats> {
  if (parsedItems.length === 0) return { inserted: 0 }

  const codes = [...new Set(parsedItems.map((p) => p.code))]
  const catalogRows = await db
    .select({ id: itemCatalog.id, code: itemCatalog.code })
    .from(itemCatalog)
    .where(sql`${itemCatalog.code} IN ${codes}`)

  const idByCode = new Map(catalogRows.map((r) => [r.code, r.id]))

  // Dedup by (catalogId, stateCode, referenceMonth, isDesonerated) — Postgres rejects
  // ON CONFLICT DO UPDATE when the same target row appears twice in one statement.
  // Last occurrence wins (XLSX price is stable per (code, UF, regime, month)).
  const dedup = new Map<string, {
    catalogId: number
    stateCode: string
    referenceMonth: string
    isDesonerated: boolean
    unitPrice: number
  }>()

  for (const p of parsedItems) {
    const catalogId = idByCode.get(p.code)
    if (!catalogId) continue
    const key = `${catalogId}:${p.stateCode}:${p.referenceMonth}:${p.isDesonerated ? 1 : 0}`
    dedup.set(key, {
      catalogId,
      stateCode: p.stateCode,
      referenceMonth: p.referenceMonth,
      isDesonerated: p.isDesonerated,
      unitPrice: p.unitPrice,
    })
  }

  const rows = [...dedup.values()]

  console.log(
    `  Inserting ${rows.length} item_prices rows (catalog resolved: ${idByCode.size}/${codes.length}, deduped from ${parsedItems.length})...`
  )

  await runInBatches(rows, 500, 'item_prices upsert', async (batch) => {
    await db
      .insert(itemPrices)
      .values(batch as any)
      .onConflictDoUpdate({
        target: [itemPrices.catalogId, itemPrices.stateCode, itemPrices.referenceMonth, itemPrices.isDesonerated],
        set: {
          unitPrice: sql`EXCLUDED.unit_price`,
        },
      })
  })

  return { inserted: rows.length }
}

async function upsertCompositionCatalog(parsedComps: ParsedComposition[]): Promise<CatalogStats> {
  const stats: CatalogStats = { newCodes: 0, unchanged: 0, divergent: 0, divergenceSamples: 0 }
  const MAX_DIVERGENCE_SAMPLES = 20

  const byCode = new Map<number, { description: string; unit: string }>()
  for (const p of parsedComps) {
    if (!byCode.has(p.code)) {
      byCode.set(p.code, { description: p.description, unit: p.unit })
    }
  }

  const uniqueCodes = [...byCode.keys()]
  if (uniqueCodes.length === 0) return stats

  console.log(`  Upserting ${uniqueCodes.length} unique composition codes...`)

  const currentRows = await db
    .select({
      code: compositionCatalog.code,
      description: compositionCatalog.description,
      unit: compositionCatalog.unit,
    })
    .from(compositionCatalog)
    .where(sql`${compositionCatalog.code} IN ${uniqueCodes}`)

  const currentMap = new Map(currentRows.map((r) => [r.code, { description: r.description, unit: r.unit }]))

  for (const [code, incoming] of byCode) {
    const existing = currentMap.get(code)
    if (!existing) {
      stats.newCodes++
      continue
    }
    const descDiff = normalizeForCompare(existing.description) !== normalizeForCompare(incoming.description)
    const unitDiff = normalizeForCompare(existing.unit) !== normalizeForCompare(incoming.unit)
    if (descDiff || unitDiff) {
      stats.divergent++
      if (stats.divergenceSamples < MAX_DIVERGENCE_SAMPLES) {
        if (descDiff) {
          console.warn(
            `[divergence] composition_code=${code} description: "${existing.description}" -> "${incoming.description}"`
          )
        }
        if (unitDiff) {
          console.warn(
            `[divergence] composition_code=${code} unit: "${existing.unit}" -> "${incoming.unit}"`
          )
        }
        stats.divergenceSamples++
      }
    } else {
      stats.unchanged++
    }
  }

  const rows = [...byCode.entries()].map(([code, v]) => ({
    code,
    description: v.description,
    unit: v.unit,
  }))

  await runInBatches(rows, 500, 'composition_catalog upsert', async (batch) => {
    await db
      .insert(compositionCatalog)
      .values(batch as any)
      .onConflictDoUpdate({
        target: compositionCatalog.code,
        set: {
          description: sql`EXCLUDED.description`,
          unit: sql`EXCLUDED.unit`,
          updatedAt: sql`NOW()`,
        },
      })
  })

  return stats
}

async function insertCompositionPrices(parsedComps: ParsedComposition[]): Promise<PricesStats> {
  if (parsedComps.length === 0) return { inserted: 0 }

  const codes = [...new Set(parsedComps.map((p) => p.code))]
  const catalogRows = await db
    .select({ id: compositionCatalog.id, code: compositionCatalog.code })
    .from(compositionCatalog)
    .where(sql`${compositionCatalog.code} IN ${codes}`)

  const idByCode = new Map(catalogRows.map((r) => [r.code, r.id]))

  // Dedup — see note in insertItemPrices.
  const dedup = new Map<string, {
    catalogId: number
    stateCode: string
    referenceMonth: string
    isDesonerated: boolean
    baseUnitCost: number
  }>()

  for (const p of parsedComps) {
    const catalogId = idByCode.get(p.code)
    if (!catalogId) continue
    const key = `${catalogId}:${p.stateCode}:${p.referenceMonth}:${p.isDesonerated ? 1 : 0}`
    dedup.set(key, {
      catalogId,
      stateCode: p.stateCode,
      referenceMonth: p.referenceMonth,
      isDesonerated: p.isDesonerated,
      baseUnitCost: p.baseUnitCost,
    })
  }

  const rows = [...dedup.values()]

  console.log(
    `  Inserting ${rows.length} composition_prices rows (catalog resolved: ${idByCode.size}/${codes.length}, deduped from ${parsedComps.length})...`
  )

  await runInBatches(rows, 500, 'composition_prices upsert', async (batch) => {
    await db
      .insert(compositionPrices)
      .values(batch as any)
      .onConflictDoUpdate({
        target: [
          compositionPrices.catalogId,
          compositionPrices.stateCode,
          compositionPrices.referenceMonth,
          compositionPrices.isDesonerated,
        ],
        set: {
          baseUnitCost: sql`EXCLUDED.base_unit_cost`,
        },
      })
  })

  return { inserted: rows.length }
}

async function upsertCompositionItemsV2(parsedItems: ParsedCompositionItem[]): Promise<number> {
  if (parsedItems.length === 0) return 0

  const compCodes = [...new Set(parsedItems.map((p) => p.compositionCode))]
  const catalogRows = await db
    .select({ id: compositionCatalog.id, code: compositionCatalog.code })
    .from(compositionCatalog)
    .where(sql`${compositionCatalog.code} IN ${compCodes}`)

  const idByCode = new Map(catalogRows.map((r) => [r.code, r.id]))
  console.log(`  Resolved ${idByCode.size}/${compCodes.length} composition IDs`)

  // Dedup by (compositionId, itemType, itemCode) — coefficients are national, first wins
  const seen = new Set<string>()
  const rows: Array<{
    compositionId: number
    itemType: string
    itemCode: number
    description: string
    unit: string
    resourceType: string | null
    coefficient: string
  }> = []

  for (const ci of parsedItems) {
    const compositionId = idByCode.get(ci.compositionCode)
    if (!compositionId) continue
    const key = `${compositionId}:${ci.itemType}:${ci.code}`
    if (seen.has(key)) continue
    seen.add(key)
    rows.push({
      compositionId,
      itemType: ci.itemType,
      itemCode: ci.code,
      description: ci.description,
      unit: ci.unit,
      resourceType: null,
      coefficient: ci.coefficient,
    })
  }

  console.log(`  Deduped to ${rows.length} unique composition_items_v2 rows`)

  await runInBatches(rows, 500, 'composition_items_v2 upsert', async (batch) => {
    await db.insert(compositionItemsV2).values(batch as any).onConflictDoNothing()
  })

  return rows.length
}

export async function runSinapiImport({ referenceMonth, filePath: rawPath }: RunSinapiImportArgs) {
  const filePath = resolve(rawPath)

  console.log(`Reading SINAPI file: ${filePath}`)
  console.log(`Reference month: ${referenceMonth}`)

  const workbook = XLSX.readFile(filePath)
  console.log(`Sheets found: ${workbook.SheetNames.join(', ')}`)

  const allItems: ParsedItem[] = []
  const allCompositions: ParsedComposition[] = []
  const allCompositionItems: ParsedCompositionItem[] = []

  // First, extract composition codes from Analítico (CSD/CCD has code=0 for all rows)
  const analiticoName = workbook.SheetNames.find((n) =>
    n.toUpperCase() === 'ANALÍTICO' || n.toUpperCase() === 'ANALITICO'
  )

  let compositionCodeMap = new Map<string, number>()
  if (analiticoName) {
    console.log(`Building composition code map from ${analiticoName}...`)
    compositionCodeMap = buildCompositionCodeMap(workbook.Sheets[analiticoName])
    console.log(`  -> ${compositionCodeMap.size} unique composition codes mapped`)
  } else {
    console.warn('Sheet Analítico not found — composition import will fail')
  }

  // Parse insumos
  const insumoSheets: Record<string, boolean> = {
    'ISD': false,
    'ICD': true,
  }

  for (const [sheetPrefix, isDesonerated] of Object.entries(insumoSheets)) {
    const sheetName = workbook.SheetNames.find((n) => n.toUpperCase() === sheetPrefix)
    if (!sheetName) {
      console.warn(`Sheet ${sheetPrefix} not found, skipping...`)
      continue
    }
    console.log(`Parsing sheet: ${sheetName} (insumos, desonerated=${isDesonerated})...`)
    const parsed = parseInsumosSheet(workbook.Sheets[sheetName], referenceMonth, isDesonerated)
    console.log(`  -> ${parsed.length} records`)
    allItems.push(...parsed)
  }

  // Parse composições
  const composicaoSheets: Record<string, boolean> = {
    'CSD': false,
    'CCD': true,
  }

  for (const [sheetPrefix, isDesonerated] of Object.entries(composicaoSheets)) {
    const sheetName = workbook.SheetNames.find((n) => n.toUpperCase() === sheetPrefix)
    if (!sheetName) {
      console.warn(`Sheet ${sheetPrefix} not found, skipping...`)
      continue
    }
    console.log(`Parsing sheet: ${sheetName} (composições, desonerated=${isDesonerated})...`)
    const parsed = parseComposicoesSheet(
      workbook.Sheets[sheetName],
      referenceMonth,
      isDesonerated,
      compositionCodeMap
    )
    console.log(`  -> ${parsed.length} records`)
    allCompositions.push(...parsed)
  }

  // Parse analítico items
  if (analiticoName) {
    console.log(`Parsing sheet: ${analiticoName} (items)...`)
    const parsed = parseAnaliticoSheet(workbook.Sheets[analiticoName])
    console.log(`  -> ${parsed.length} records`)
    allCompositionItems.push(...parsed)
  }

  console.log(`\nTotal items: ${allItems.length}`)
  console.log(`Total compositions: ${allCompositions.length}`)
  console.log(`Total composition items: ${allCompositionItems.length}`)

  if (allItems.length === 0 && allCompositions.length === 0) {
    console.warn('No data found to import. Exiting.')
    process.exit(0)
  }

  // Write phase
  let itemCatalogStats: CatalogStats = { newCodes: 0, unchanged: 0, divergent: 0, divergenceSamples: 0 }
  let itemPricesStats: PricesStats = { inserted: 0 }
  let compCatalogStats: CatalogStats = { newCodes: 0, unchanged: 0, divergent: 0, divergenceSamples: 0 }
  let compPricesStats: PricesStats = { inserted: 0 }
  let compItemsInserted = 0

  if (allItems.length > 0) {
    console.log('\n[1/5] item_catalog upsert...')
    itemCatalogStats = await upsertItemCatalog(allItems)
    console.log('\n[2/5] item_prices upsert...')
    itemPricesStats = await insertItemPrices(allItems)
  }

  if (allCompositions.length > 0) {
    console.log('\n[3/5] composition_catalog upsert...')
    compCatalogStats = await upsertCompositionCatalog(allCompositions)
    console.log('\n[4/5] composition_prices upsert...')
    compPricesStats = await insertCompositionPrices(allCompositions)
  }

  if (allCompositionItems.length > 0) {
    console.log('\n[5/5] composition_items_v2 upsert...')
    compItemsInserted = await upsertCompositionItemsV2(allCompositionItems)
  }

  console.log('')
  console.log('=== Import complete ===')
  console.log(`  Items — new codes:           ${itemCatalogStats.newCodes}`)
  console.log(`  Items — updated (no change): ${itemCatalogStats.unchanged}`)
  console.log(`  Items — updated (divergent): ${itemCatalogStats.divergent}`)
  console.log(`  Items — prices inserted:     ${itemPricesStats.inserted}`)
  console.log(`  Compositions — new codes:           ${compCatalogStats.newCodes}`)
  console.log(`  Compositions — updated (no change): ${compCatalogStats.unchanged}`)
  console.log(`  Compositions — updated (divergent): ${compCatalogStats.divergent}`)
  console.log(`  Compositions — prices inserted:     ${compPricesStats.inserted}`)
  console.log(`  Composition items inserted:         ${compItemsInserted}`)
}

if (import.meta.main) {
  const SINAPI_REFERENCE_MONTH = process.argv[2]
  const FILE_PATH = process.argv[3]

  if (!SINAPI_REFERENCE_MONTH || !FILE_PATH) {
    console.error('Usage: bun run src/db/import/sinapi.ts <YYYY-MM> <path-to-xlsx>')
    process.exit(1)
  }

  runSinapiImport({ referenceMonth: SINAPI_REFERENCE_MONTH, filePath: FILE_PATH })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Import failed:', err)
      process.exit(1)
    })
}
