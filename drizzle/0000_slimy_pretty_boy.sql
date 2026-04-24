CREATE SCHEMA "civil_construction";
--> statement-breakpoint
CREATE TABLE "civil_construction"."categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" varchar(100) NOT NULL,
	"name" varchar(255) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "categories_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "civil_construction"."composition_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"composition_id" integer NOT NULL,
	"item_type" varchar(20) NOT NULL,
	"code" integer NOT NULL,
	"description" text NOT NULL,
	"unit" varchar(20) NOT NULL,
	"resource_type" varchar(20),
	"coefficient" numeric(12, 6) NOT NULL,
	"unit_price" integer DEFAULT 0 NOT NULL,
	"total_price" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "civil_construction"."compositions" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" integer NOT NULL,
	"description" text NOT NULL,
	"unit" varchar(20) NOT NULL,
	"state_code" varchar(2) NOT NULL,
	"reference_month" varchar(7) NOT NULL,
	"is_desonerated" boolean DEFAULT false NOT NULL,
	"base_unit_cost" integer DEFAULT 0 NOT NULL,
	"source_updated_at" varchar(20),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "civil_construction"."items" (
	"id" serial PRIMARY KEY NOT NULL,
	"category_id" integer,
	"code" integer NOT NULL,
	"description" text NOT NULL,
	"unit" varchar(20) NOT NULL,
	"state_code" varchar(2) NOT NULL,
	"reference_month" varchar(7) NOT NULL,
	"is_desonerated" boolean DEFAULT false NOT NULL,
	"unit_price" integer DEFAULT 0 NOT NULL,
	"technical_standards" text,
	"general_info" text,
	"image_url" varchar(500),
	"metadata" jsonb,
	"source_updated_at" varchar(20),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sectors" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" varchar(100) NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"schema_name" varchar(100) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sectors_slug_unique" UNIQUE("slug"),
	CONSTRAINT "sectors_schema_name_unique" UNIQUE("schema_name")
);
--> statement-breakpoint
ALTER TABLE "civil_construction"."composition_items" ADD CONSTRAINT "composition_items_composition_id_compositions_id_fk" FOREIGN KEY ("composition_id") REFERENCES "civil_construction"."compositions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "civil_construction"."items" ADD CONSTRAINT "items_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "civil_construction"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "composition_items_composition_id_idx" ON "civil_construction"."composition_items" USING btree ("composition_id");--> statement-breakpoint
CREATE INDEX "composition_items_code_idx" ON "civil_construction"."composition_items" USING btree ("code");--> statement-breakpoint
CREATE INDEX "composition_items_item_type_idx" ON "civil_construction"."composition_items" USING btree ("item_type");--> statement-breakpoint
CREATE INDEX "compositions_code_idx" ON "civil_construction"."compositions" USING btree ("code");--> statement-breakpoint
CREATE INDEX "compositions_state_code_idx" ON "civil_construction"."compositions" USING btree ("state_code");--> statement-breakpoint
CREATE INDEX "compositions_reference_month_idx" ON "civil_construction"."compositions" USING btree ("reference_month");--> statement-breakpoint
CREATE INDEX "compositions_is_desonerated_idx" ON "civil_construction"."compositions" USING btree ("is_desonerated");--> statement-breakpoint
CREATE INDEX "compositions_state_month_idx" ON "civil_construction"."compositions" USING btree ("state_code","reference_month");--> statement-breakpoint
CREATE UNIQUE INDEX "compositions_unique_natural_key" ON "civil_construction"."compositions" USING btree ("code","state_code","reference_month","is_desonerated");--> statement-breakpoint
CREATE INDEX "compositions_search_idx" ON "civil_construction"."compositions" USING gin (to_tsvector('portuguese', "description"));--> statement-breakpoint
CREATE INDEX "items_code_idx" ON "civil_construction"."items" USING btree ("code");--> statement-breakpoint
CREATE INDEX "items_unit_idx" ON "civil_construction"."items" USING btree ("unit");--> statement-breakpoint
CREATE INDEX "items_state_code_idx" ON "civil_construction"."items" USING btree ("state_code");--> statement-breakpoint
CREATE INDEX "items_reference_month_idx" ON "civil_construction"."items" USING btree ("reference_month");--> statement-breakpoint
CREATE INDEX "items_is_desonerated_idx" ON "civil_construction"."items" USING btree ("is_desonerated");--> statement-breakpoint
CREATE INDEX "items_state_month_idx" ON "civil_construction"."items" USING btree ("state_code","reference_month");--> statement-breakpoint
CREATE UNIQUE INDEX "items_unique_natural_key" ON "civil_construction"."items" USING btree ("code","state_code","reference_month","is_desonerated");--> statement-breakpoint
CREATE INDEX "items_search_idx" ON "civil_construction"."items" USING gin (to_tsvector('portuguese', "description" || ' ' || coalesce("general_info", '')));