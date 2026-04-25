-- Block 6: drop legacy tables and rename composition_items_v2 to composition_items.
--
-- The legacy tables (items, compositions, composition_items) have no readers/writers
-- after Blocks 3-5 — all services, importers, seed and tests use the new dimensional
-- schema. Data was migrated in Block 2 via src/db/import/restructure.ts.
--
-- IMPORTANT: this migration uses ALTER TABLE RENAME rather than DROP+CREATE to preserve
-- the 42476 rows of composition_items_v2 (coefficients table).

DROP TABLE IF EXISTS "civil_construction"."composition_items" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "civil_construction"."compositions" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "civil_construction"."items" CASCADE;
--> statement-breakpoint
ALTER TABLE "civil_construction"."composition_items_v2" RENAME TO "composition_items";
--> statement-breakpoint
ALTER INDEX "civil_construction"."composition_items_v2_unique" RENAME TO "composition_items_unique";
--> statement-breakpoint
ALTER INDEX "civil_construction"."composition_items_v2_composition_id_idx" RENAME TO "composition_items_composition_id_idx";
--> statement-breakpoint
ALTER INDEX "civil_construction"."composition_items_v2_item_code_idx" RENAME TO "composition_items_item_code_idx";
--> statement-breakpoint
ALTER INDEX "civil_construction"."composition_items_v2_item_type_idx" RENAME TO "composition_items_item_type_idx";
--> statement-breakpoint
ALTER TABLE "civil_construction"."composition_items" RENAME CONSTRAINT "composition_items_v2_composition_id_composition_catalog_id_fk" TO "composition_items_composition_id_composition_catalog_id_fk";
