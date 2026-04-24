import { seedCivilConstruction } from './civil-construction'
import { resolve } from 'path'

const DATA_PATH = process.argv[2] ?? resolve(process.cwd(), 'data/sample-data.json')

async function main() {
  console.log('Starting seed...')
  console.log(`Using data file: ${DATA_PATH}`)
  await seedCivilConstruction(DATA_PATH)
  console.log('Seed complete.')
  process.exit(0)
}

main().catch((err) => {
  console.error('Seed failed:', err)
  process.exit(1)
})
