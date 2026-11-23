CREATE TYPE "public"."suggested_edit_kind" AS ENUM('adds', 'contradicts');--> statement-breakpoint
CREATE TYPE "public"."suggested_edit_status" AS ENUM('pending', 'accepted', 'rejected');--> statement-breakpoint
CREATE TABLE "suggested_edits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"topic_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"kind" "suggested_edit_kind" NOT NULL,
	"summary" text NOT NULL,
	"key_point_id" text,
	"text" text NOT NULL,
	"citations" jsonb NOT NULL,
	"status" "suggested_edit_status" DEFAULT 'pending' NOT NULL,
	"base_version_id" uuid,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "suggested_edits" ADD CONSTRAINT "suggested_edits_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggested_edits" ADD CONSTRAINT "suggested_edits_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggested_edits" ADD CONSTRAINT "suggested_edits_base_version_id_explainer_versions_id_fk" FOREIGN KEY ("base_version_id") REFERENCES "public"."explainer_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "suggested_edits_topic_status" ON "suggested_edits" USING btree ("topic_id","status");