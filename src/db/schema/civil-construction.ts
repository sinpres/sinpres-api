import { pgSchema, serial, integer, text, varchar, timestamp, jsonb, index, boolean, numeric, uniqueIndex } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const civilConstructionSchema = pgSchema('civil_construction')

export const categories = civilConstructionSchema.table('categories', {
  id: serial('id').primaryKey(),
  slug: varchar('slug', { length: 100 }).notNull().unique(),
  name: varchar('name', { length: 255 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const items = civilConstructionSchema.table('items', {
  id: serial('id').primaryKey(),
  categoryId: integer('category_id').references(() => categories.id),
  code: integer('code').notNull(),
  description: text('description').notNull(),
  unit: varchar('unit', { length: 20 }).notNull(),
  stateCode: varchar('state_code', { length: 2 }).notNull(),
  referenceMonth: varchar('reference_month', { length: 7 }).notNull(),
  isDesonerated: boolean('is_desonerated').notNull().default(false),
  unitPrice: integer('unit_price').notNull().default(0),
  technicalStandards: text('technical_standards'),
  generalInfo: text('general_info'),
  imageUrl: varchar('image_url', { length: 500 }),
  metadata: jsonb('metadata'),
  sourceUpdatedAt: varchar('source_updated_at', { length: 20 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('items_code_idx').on(table.code),
  index('items_unit_idx').on(table.unit),
  index('items_state_code_idx').on(table.stateCode),
  index('items_reference_month_idx').on(table.referenceMonth),
  index('items_is_desonerated_idx').on(table.isDesonerated),
  index('items_state_month_idx').on(table.stateCode, table.referenceMonth),
  uniqueIndex('items_unique_natural_key').on(table.code, table.stateCode, table.referenceMonth, table.isDesonerated),
  index('items_search_idx').using(
    'gin',
    sql`to_tsvector('portuguese', ${table.description} || ' ' || coalesce(${table.generalInfo}, ''))`
  ),
])

export const compositions = civilConstructionSchema.table('compositions', {
  id: serial('id').primaryKey(),
  code: integer('code').notNull(),
  description: text('description').notNull(),
  unit: varchar('unit', { length: 20 }).notNull(),
  stateCode: varchar('state_code', { length: 2 }).notNull(),
  referenceMonth: varchar('reference_month', { length: 7 }).notNull(),
  isDesonerated: boolean('is_desonerated').notNull().default(false),
  baseUnitCost: integer('base_unit_cost').notNull().default(0),
  sourceUpdatedAt: varchar('source_updated_at', { length: 20 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('compositions_code_idx').on(table.code),
  index('compositions_state_code_idx').on(table.stateCode),
  index('compositions_reference_month_idx').on(table.referenceMonth),
  index('compositions_is_desonerated_idx').on(table.isDesonerated),
  index('compositions_state_month_idx').on(table.stateCode, table.referenceMonth),
  uniqueIndex('compositions_unique_natural_key').on(table.code, table.stateCode, table.referenceMonth, table.isDesonerated),
  index('compositions_search_idx').using(
    'gin',
    sql`to_tsvector('portuguese', ${table.description})`
  ),
])

export const compositionItems = civilConstructionSchema.table('composition_items', {
  id: serial('id').primaryKey(),
  compositionId: integer('composition_id').notNull().references(() => compositions.id, { onDelete: 'cascade' }),
  itemType: varchar('item_type', { length: 20 }).notNull(), // 'INPUT' | 'SUB_COMPOSITION'
  code: integer('code').notNull(),
  description: text('description').notNull(),
  unit: varchar('unit', { length: 20 }).notNull(),
  resourceType: varchar('resource_type', { length: 20 }), // 'MATERIAL' | 'LABOR' | 'EQUIPMENT' — only for INPUT
  coefficient: numeric('coefficient', { precision: 12, scale: 6 }).notNull(),
  unitPrice: integer('unit_price').notNull().default(0),
  totalPrice: integer('total_price').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('composition_items_unique_idx').on(table.compositionId, table.itemType, table.code),
  index('composition_items_composition_id_idx').on(table.compositionId),
  index('composition_items_code_idx').on(table.code),
  index('composition_items_item_type_idx').on(table.itemType),
])

export const itemCatalog = civilConstructionSchema.table('item_catalog', {
  id: serial('id').primaryKey(),
  code: integer('code').notNull().unique(),
  description: text('description').notNull(),
  unit: varchar('unit', { length: 20 }).notNull(),
  resourceType: varchar('resource_type', { length: 30 }), // MATERIAL | MAO_DE_OBRA | EQUIPAMENTO | SERVICO | ENCARGO_COMPLEMENTAR | ESPECIAL
  imageUrl: varchar('image_url', { length: 500 }),
  technicalStandards: text('technical_standards'),
  generalInfo: text('general_info'),
  sourceUpdatedAt: varchar('source_updated_at', { length: 20 }),
  previousCode: integer('previous_code'),
  categoryId: integer('category_id').references(() => categories.id),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('item_catalog_code_idx').on(table.code),
  index('item_catalog_unit_idx').on(table.unit),
  index('item_catalog_resource_type_idx').on(table.resourceType),
  index('item_catalog_previous_code_idx').on(table.previousCode),
  index('item_catalog_search_idx').using(
    'gin',
    sql`to_tsvector('portuguese', ${table.description} || ' ' || coalesce(${table.generalInfo}, ''))`
  ),
])

export const itemPrices = civilConstructionSchema.table('item_prices', {
  id: serial('id').primaryKey(),
  catalogId: integer('catalog_id').notNull().references(() => itemCatalog.id, { onDelete: 'cascade' }),
  stateCode: varchar('state_code', { length: 2 }).notNull(),
  referenceMonth: varchar('reference_month', { length: 7 }).notNull(),
  isDesonerated: boolean('is_desonerated').notNull().default(false),
  unitPrice: integer('unit_price').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('item_prices_unique_key').on(table.catalogId, table.stateCode, table.referenceMonth, table.isDesonerated),
  index('item_prices_catalog_id_idx').on(table.catalogId),
  index('item_prices_state_month_idx').on(table.stateCode, table.referenceMonth),
  index('item_prices_reference_month_idx').on(table.referenceMonth),
  index('item_prices_is_desonerated_idx').on(table.isDesonerated),
])

export const compositionCatalog = civilConstructionSchema.table('composition_catalog', {
  id: serial('id').primaryKey(),
  code: integer('code').notNull().unique(),
  description: text('description').notNull(),
  unit: varchar('unit', { length: 20 }).notNull(),
  previousCode: integer('previous_code'),
  sourceUpdatedAt: varchar('source_updated_at', { length: 20 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('composition_catalog_code_idx').on(table.code),
  index('composition_catalog_unit_idx').on(table.unit),
  index('composition_catalog_previous_code_idx').on(table.previousCode),
  index('composition_catalog_search_idx').using(
    'gin',
    sql`to_tsvector('portuguese', ${table.description})`
  ),
])

export const compositionPrices = civilConstructionSchema.table('composition_prices', {
  id: serial('id').primaryKey(),
  catalogId: integer('catalog_id').notNull().references(() => compositionCatalog.id, { onDelete: 'cascade' }),
  stateCode: varchar('state_code', { length: 2 }).notNull(),
  referenceMonth: varchar('reference_month', { length: 7 }).notNull(),
  isDesonerated: boolean('is_desonerated').notNull().default(false),
  baseUnitCost: integer('base_unit_cost').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('composition_prices_unique_key').on(table.catalogId, table.stateCode, table.referenceMonth, table.isDesonerated),
  index('composition_prices_catalog_id_idx').on(table.catalogId),
  index('composition_prices_state_month_idx').on(table.stateCode, table.referenceMonth),
  index('composition_prices_reference_month_idx').on(table.referenceMonth),
  index('composition_prices_is_desonerated_idx').on(table.isDesonerated),
])

// Nome temporário durante coexistência — Bloco 6 renomeia para composition_items após dropar a antiga
export const compositionItemsV2 = civilConstructionSchema.table('composition_items_v2', {
  id: serial('id').primaryKey(),
  compositionId: integer('composition_id').notNull().references(() => compositionCatalog.id, { onDelete: 'cascade' }),
  itemType: varchar('item_type', { length: 20 }).notNull(), // 'INPUT' | 'SUB_COMPOSITION'
  itemCode: integer('item_code').notNull(), // FK lógica: item_catalog.code quando INPUT, composition_catalog.code quando SUB_COMPOSITION
  description: text('description').notNull(),
  unit: varchar('unit', { length: 20 }).notNull(),
  resourceType: varchar('resource_type', { length: 20 }),
  coefficient: numeric('coefficient', { precision: 12, scale: 6 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('composition_items_v2_unique').on(table.compositionId, table.itemType, table.itemCode),
  index('composition_items_v2_composition_id_idx').on(table.compositionId),
  index('composition_items_v2_item_code_idx').on(table.itemCode),
  index('composition_items_v2_item_type_idx').on(table.itemType),
])
