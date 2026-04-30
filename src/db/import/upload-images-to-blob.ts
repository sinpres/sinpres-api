/**
 * Uploads SINAPI item images to Vercel Blob and updates item_catalog.image_url with
 * the public absolute URL.
 *
 * Source: input/images/<code>.{jpeg,png,jpg}
 * Target: Blob path images/<code>.<ext> (deterministic, no random suffix)
 *
 * Idempotent: if catalog row already has an https:// URL whose path ends with the
 * same filename, we skip the upload (saves bandwidth and keeps URL stable).
 *
 * Requires BLOB_READ_WRITE_TOKEN in environment. Concurrency = 10 to keep the run
 * under ~2 minutes for ~6000 files without tripping rate limits.
 *
 * Usage:
 *   bun run src/db/import/upload-images-to-blob.ts [<images-dir>]
 *
 * Default images-dir: input/images relative to project root.
 */
import { put } from '@vercel/blob'
import { db } from '../client'
import { itemCatalog } from '../schema/civil-construction'
import { eq, sql } from 'drizzle-orm'
import { readFileSync, readdirSync, statSync } from 'fs'
import { resolve, extname, basename } from 'path'

const PROJECT_ROOT = resolve(__dirname, '../../..')
const DEFAULT_IMAGES_DIR = resolve(PROJECT_ROOT, 'input/images')

const CONCURRENCY = 10

interface UploadStats {
  uploaded: number
  skipped: number
  notInCatalog: number
  failed: number
  invalidName: number
}

function detectContentType(filename: string): string {
  const ext = extname(filename).toLowerCase()
  if (ext === '.jpeg' || ext === '.jpg') return 'image/jpeg'
  if (ext === '.png') return 'image/png'
  if (ext === '.gif') return 'image/gif'
  if (ext === '.webp') return 'image/webp'
  return 'application/octet-stream'
}

function parseCodeFromFilename(filename: string): number | null {
  const stem = basename(filename, extname(filename))
  const code = parseInt(stem, 10)
  return Number.isFinite(code) && code > 0 ? code : null
}

async function processOne(
  filename: string,
  imagesDir: string,
  catalogIndex: Map<number, { id: number; imageUrl: string | null }>,
  stats: UploadStats,
) {
  const code = parseCodeFromFilename(filename)
  if (code === null) {
    stats.invalidName++
    return
  }

  const catalogRow = catalogIndex.get(code)
  if (!catalogRow) {
    stats.notInCatalog++
    return
  }

  const blobPath = `images/${filename}`
  const expectedSuffix = `/${blobPath}`
  if (catalogRow.imageUrl?.startsWith('https://') && catalogRow.imageUrl.endsWith(expectedSuffix)) {
    stats.skipped++
    return
  }

  const filepath = resolve(imagesDir, filename)
  let buf: Buffer
  try {
    buf = readFileSync(filepath)
  } catch {
    stats.failed++
    console.warn(`  [warn] could not read ${filepath}`)
    return
  }

  try {
    const blob = await put(blobPath, buf, {
      access: 'public',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: detectContentType(filename),
    })

    await db
      .update(itemCatalog)
      .set({ imageUrl: blob.url, updatedAt: sql`NOW()` })
      .where(eq(itemCatalog.code, code))

    stats.uploaded++
  } catch (err) {
    stats.failed++
    console.warn(`  [warn] upload failed for code=${code}: ${(err as Error).message}`)
  }
}

async function runInChunks<T>(items: T[], size: number, fn: (item: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += size) {
    const chunk = items.slice(i, i + size)
    await Promise.allSettled(chunk.map(fn))
  }
}

export async function runImageUpload(imagesDirArg?: string) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error('BLOB_READ_WRITE_TOKEN missing in environment')
  }

  const imagesDir = imagesDirArg ?? DEFAULT_IMAGES_DIR
  console.log(`Reading images from: ${imagesDir}`)

  let entries: string[]
  try {
    entries = readdirSync(imagesDir)
  } catch (err) {
    throw new Error(`Cannot list ${imagesDir}: ${(err as Error).message}`)
  }

  const filenames = entries.filter((name) => {
    if (name.startsWith('.') || name.startsWith('._')) return false
    const filepath = resolve(imagesDir, name)
    try {
      return statSync(filepath).isFile()
    } catch {
      return false
    }
  })
  console.log(`  -> ${filenames.length} files found`)

  const catalogRows = await db
    .select({ id: itemCatalog.id, code: itemCatalog.code, imageUrl: itemCatalog.imageUrl })
    .from(itemCatalog)
  const catalogIndex = new Map(catalogRows.map((r) => [r.code, { id: r.id, imageUrl: r.imageUrl }]))
  console.log(`  -> ${catalogIndex.size} codes in item_catalog`)

  const stats: UploadStats = {
    uploaded: 0,
    skipped: 0,
    notInCatalog: 0,
    failed: 0,
    invalidName: 0,
  }

  let processed = 0
  const total = filenames.length

  await runInChunks(filenames, CONCURRENCY, async (filename) => {
    await processOne(filename, imagesDir, catalogIndex, stats)
    processed++
    if (processed % 200 === 0) {
      console.log(
        `  Progress: ${processed}/${total} — uploaded=${stats.uploaded} skipped=${stats.skipped} notInCatalog=${stats.notInCatalog} failed=${stats.failed}`
      )
    }
  })

  console.log('')
  console.log('=== Image upload complete ===')
  console.log(`  Uploaded:       ${stats.uploaded}`)
  console.log(`  Skipped:        ${stats.skipped} (already on Blob)`)
  console.log(`  Not in catalog: ${stats.notInCatalog} (image file has no matching code)`)
  console.log(`  Failed:         ${stats.failed}`)
  console.log(`  Invalid names:  ${stats.invalidName}`)
}

if (import.meta.main) {
  runImageUpload(process.argv[2])
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Image upload failed:', err)
      process.exit(1)
    })
}
