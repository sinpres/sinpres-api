CREATE TABLE "civil_construction"."composition_catalog" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" integer NOT NULL,
	"description" text NOT NULL,
	"unit" varchar(20) NOT NULL,
	"previous_code" integer,
	"source_updated_at" varchar(20),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "composition_catalog_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "civil_construction"."composition_items_v2" (
	"id" serial PRIMARY KEY NOT NULL,
	"composition_id" integer NOT NULL,
	"item_type" varchar(20) NOT NULL,
	"item_code" integer NOT NULL,
	"description" text NOT NULL,
	"unit" varchar(20) NOT NULL,
	"resource_type" varchar(20),
	"coefficient" numeric(12, 6) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "civil_construction"."composition_prices" (
	"id" serial PRIMARY KEY NOT NULL,
	"catalog_id" integer NOT NULL,
	"state_code" varchar(2) NOT NULL,
	"reference_month" varchar(7) NOT NULL,
	"is_desonerated" boolean DEFAULT false NOT NULL,
	"base_unit_cost" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "civil_construction"."item_catalog" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" integer NOT NULL,
	"description" text NOT NULL,
	"unit" varchar(20) NOT NULL,
	"resource_type" varchar(30),
	"image_url" varchar(500),
	"technical_standards" text,
	"general_info" text,
	"source_updated_at" varchar(20),
	"previous_code" integer,
	"category_id" integer,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "item_catalog_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "civil_construction"."item_prices" (
	"id" serial PRIMARY KEY NOT NULL,
	"catalog_id" integer NOT NULL,
	"state_code" varchar(2) NOT NULL,
	"reference_month" varchar(7) NOT NULL,
	"is_desonerated" boolean DEFAULT false NOT NULL,
	"unit_price" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "civil_construction"."composition_items_v2" ADD CONSTRAINT "composition_items_v2_composition_id_composition_catalog_id_fk" FOREIGN KEY ("composition_id") REFERENCES "civil_construction"."composition_catalog"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "civil_construction"."composition_prices" ADD CONSTRAINT "composition_prices_catalog_id_composition_catalog_id_fk" FOREIGN KEY ("catalog_id") REFERENCES "civil_construction"."composition_catalog"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "civil_construction"."item_catalog" ADD CONSTRAINT "item_catalog_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "civil_construction"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "civil_construction"."item_prices" ADD CONSTRAINT "item_prices_catalog_id_item_catalog_id_fk" FOREIGN KEY ("catalog_id") REFERENCES "civil_construction"."item_catalog"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "composition_catalog_code_idx" ON "civil_construction"."composition_catalog" USING btree ("code");--> statement-breakpoint
CREATE INDEX "composition_catalog_unit_idx" ON "civil_construction"."composition_catalog" USING btree ("unit");--> statement-breakpoint
CREATE INDEX "composition_catalog_previous_code_idx" ON "civil_construction"."composition_catalog" USING btree ("previous_code");--> statement-breakpoint
CREATE INDEX "composition_catalog_search_idx" ON "civil_construction"."composition_catalog" USING gin (to_tsvector('portuguese', "description"));--> statement-breakpoint
CREATE UNIQUE INDEX "composition_items_v2_unique" ON "civil_construction"."composition_items_v2" USING btree ("composition_id","item_type","item_code");--> statement-breakpoint
CREATE INDEX "composition_items_v2_composition_id_idx" ON "civil_construction"."composition_items_v2" USING btree ("composition_id");--> statement-breakpoint
CREATE INDEX "composition_items_v2_item_code_idx" ON "civil_construction"."composition_items_v2" USING btree ("item_code");--> statement-breakpoint
CREATE INDEX "composition_items_v2_item_type_idx" ON "civil_construction"."composition_items_v2" USING btree ("item_type");--> statement-breakpoint
CREATE UNIQUE INDEX "composition_prices_unique_key" ON "civil_construction"."composition_prices" USING btree ("catalog_id","state_code","reference_month","is_desonerated");--> statement-breakpoint
CREATE INDEX "composition_prices_catalog_id_idx" ON "civil_construction"."composition_prices" USING btree ("catalog_id");--> statement-breakpoint
CREATE INDEX "composition_prices_state_month_idx" ON "civil_construction"."composition_prices" USING btree ("state_code","reference_month");--> statement-breakpoint
CREATE INDEX "composition_prices_reference_month_idx" ON "civil_construction"."composition_prices" USING btree ("reference_month");--> statement-breakpoint
CREATE INDEX "composition_prices_is_desonerated_idx" ON "civil_construction"."composition_prices" USING btree ("is_desonerated");--> statement-breakpoint
CREATE INDEX "item_catalog_code_idx" ON "civil_construction"."item_catalog" USING btree ("code");--> statement-breakpoint
CREATE INDEX "item_catalog_unit_idx" ON "civil_construction"."item_catalog" USING btree ("unit");--> statement-breakpoint
CREATE INDEX "item_catalog_resource_type_idx" ON "civil_construction"."item_catalog" USING btree ("resource_type");--> statement-breakpoint
CREATE INDEX "item_catalog_previous_code_idx" ON "civil_construction"."item_catalog" USING btree ("previous_code");--> statement-breakpoint
CREATE INDEX "item_catalog_search_idx" ON "civil_construction"."item_catalog" USING gin (to_tsvector('portuguese', "description" || ' ' || coalesce("general_info", '')));--> statement-breakpoint
CREATE UNIQUE INDEX "item_prices_unique_key" ON "civil_construction"."item_prices" USING btree ("catalog_id","state_code","reference_month","is_desonerated");--> statement-breakpoint
CREATE INDEX "item_prices_catalog_id_idx" ON "civil_construction"."item_prices" USING btree ("catalog_id");--> statement-breakpoint
CREATE INDEX "item_prices_state_month_idx" ON "civil_construction"."item_prices" USING btree ("state_code","reference_month");--> statement-breakpoint
CREATE INDEX "item_prices_reference_month_idx" ON "civil_construction"."item_prices" USING btree ("reference_month");--> statement-breakpoint
CREATE INDEX "item_prices_is_desonerated_idx" ON "civil_construction"."item_prices" USING btree ("is_desonerated");