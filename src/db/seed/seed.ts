import { seedCivilConstruction } from './civil-construction'

const DATA_PATH = process.argv[2]

if (!DATA_PATH) {
  console.error('Usage: bun run src/db/seed/seed.ts <path-to-items.json>')
  process.exit(1)
}

async function main() {
  console.log('Starting seed...')
  await seedCivilConstruction(DATA_PATH)
  console.log('Seed complete.')
  process.exit(0)
}

main().catch((err) => {
  console.error('Seed failed:', err)
  process.exit(1)
})
