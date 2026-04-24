import * as XLSX from 'xlsx'
import { db } from '../client'
import { items, compositions, compositionItems } from '../schema/civil-construction'
import { sql } from 'drizzle-orm'
import { resolve } from 'path'

const SINAPI_REFERENCE_MONTH = process.argv[2]
const FILE_PATH = process.argv[3]

if (!SINAPI_REFERENCE_MONTH || !FILE_PATH) {
  console.error('Usage: bun run src/db/import/sinapi.ts <YYYY-MM> <path-to-xlsx>')
  process.exit(1)
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

async function insertInBatches<T>(
  data: T[],
  batchSize: number,
  label: string,
  inserter: (batch: T[]) => Promise<void>
) {
  for (let i = 0; i < data.length; i += batchSize) {
    const batch = data.slice(i, i + batchSize)
    await inserter(batch)
    console.log(`  ${label}: ${Math.min(i + batchSize, data.length)}/${data.length}`)
  }
}

async function main() {
  const filePath = resolve(FILE_PATH)
  const referenceMonth = SINAPI_REFERENCE_MONTH

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

  // Insert items
  if (allItems.length > 0) {
    console.log('\nInserting items...')
    await insertInBatches(allItems, 500, 'Items', async (batch) => {
      await db.insert(items).values(batch as any).onConflictDoNothing()
    })
  }

  // Insert compositions
  if (allCompositions.length > 0) {
    console.log('\nInserting compositions...')
    await insertInBatches(allCompositions, 500, 'Compositions', async (batch) => {
      await db.insert(compositions).values(batch as any).onConflictDoNothing()
    })
  }

  // Insert composition items
  if (allCompositionItems.length > 0) {
    console.log('\nResolving composition IDs for items...')
    const compCodes = [...new Set(allCompositionItems.map((ci) => ci.compositionCode))]
    const compRecords = await db
      .select({ id: compositions.id, code: compositions.code })
      .from(compositions)
      .where(sql`${compositions.code} IN ${compCodes}`)

    const compIdMap = new Map(compRecords.map((r) => [r.code, r.id]))
    console.log(`  Resolved ${compIdMap.size} composition IDs`)

    const itemsWithIds = allCompositionItems
      .map((ci) => {
        const compositionId = compIdMap.get(ci.compositionCode)
        if (!compositionId) return null
        return {
          compositionId,
          itemType: ci.itemType,
          code: ci.code,
          description: ci.description,
          unit: ci.unit,
          resourceType: null as string | null,
          coefficient: ci.coefficient,
          unitPrice: 0,
          totalPrice: 0,
        }
      })
      .filter(Boolean) as any[]

    if (itemsWithIds.length > 0) {
      await insertInBatches(itemsWithIds, 500, 'Composition items', async (batch) => {
        await db.insert(compositionItems).values(batch).onConflictDoNothing()
      })
    }
  }

  console.log('\nImport complete!')
  process.exit(0)
}

main().catch((err) => {
  console.error('Import failed:', err)
  process.exit(1)
})
