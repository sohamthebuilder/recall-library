CREATE TABLE "source_chapters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"title" text NOT NULL,
	"start_page" integer NOT NULL,
	"end_page" integer NOT NULL,
	"selected_at" timestamp with time zone,
	"topics_proposed_at" timestamp with time zone,
	"failure_reason" text
);
--> statement-breakpoint
ALTER TABLE "source_chapters" ADD CONSTRAINT "source_chapters_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "source_chapters_source_ordinal" ON "source_chapters" USING btree ("source_id","ordinal");