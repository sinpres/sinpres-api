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
CREATE TABLE "civil_construction"."items" (
	"id" serial PRIMARY KEY NOT NULL,
	"category_id" integer,
	"code" integer NOT NULL,
	"description" text NOT NULL,
	"unit" varchar(20) NOT NULL,
	"technical_standards" text,
	"general_info" text,
	"image_url" varchar(500),
	"metadata" jsonb,
	"source_updated_at" varchar(20),
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "items_code_unique" UNIQUE("code")
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
ALTER TABLE "civil_construction"."items" ADD CONSTRAINT "items_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "civil_construction"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "items_code_idx" ON "civil_construction"."items" USING btree ("code");--> statement-breakpoint
CREATE INDEX "items_unit_idx" ON "civil_construction"."items" USING btree ("unit");--> statement-breakpoint
CREATE INDEX "items_search_idx" ON "civil_construction"."items" USING gin (to_tsvector('portuguese', "description" || ' ' || coalesce("general_info", '')));