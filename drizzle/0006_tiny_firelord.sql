CREATE EXTENSION IF NOT EXISTS unaccent;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE TEXT SEARCH CONFIGURATION "portuguese_unaccent" (COPY = "portuguese");--> statement-breakpoint
ALTER TEXT SEARCH CONFIGURATION "portuguese_unaccent" ALTER MAPPING FOR hword, hword_part, word WITH unaccent, portuguese_stem;--> statement-breakpoint
DROP INDEX "civil_construction"."composition_catalog_search_idx";--> statement-breakpoint
DROP INDEX "civil_construction"."item_catalog_search_idx";--> statement-breakpoint
CREATE INDEX "composition_catalog_description_trgm_idx" ON "civil_construction"."composition_catalog" USING gin ("description" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "item_catalog_description_trgm_idx" ON "civil_construction"."item_catalog" USING gin ("description" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "composition_catalog_search_idx" ON "civil_construction"."composition_catalog" USING gin (to_tsvector('portuguese_unaccent', "description"));--> statement-breakpoint
CREATE INDEX "item_catalog_search_idx" ON "civil_construction"."item_catalog" USING gin (to_tsvector('portuguese_unaccent', "description" || ' ' || coalesce("general_info", '')));