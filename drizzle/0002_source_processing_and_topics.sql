CREATE TYPE "public"."job_status" AS ENUM('queued', 'running', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."source_status" AS ENUM('pending', 'fetching', 'extracting', 'proposing_topics', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."topic_proposal_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "source_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"text" text NOT NULL,
	"anchor" jsonb NOT NULL,
	"embedding" vector(1536) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "topic_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"matched_topic_id" uuid,
	"status" "topic_proposal_status" DEFAULT 'pending' NOT NULL,
	"resolved_topic_id" uuid,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "topic_sources" (
	"topic_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"linked_at" timestamp with time zone NOT NULL,
	CONSTRAINT "topic_sources_topic_id_source_id_pk" PRIMARY KEY("topic_id","source_id")
);
--> statement-breakpoint
CREATE TABLE "topics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"embedding" vector(1536) NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sources" ALTER COLUMN "text" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "status" "source_status" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "failure_reason" text;--> statement-breakpoint
ALTER TABLE "source_chunks" ADD CONSTRAINT "source_chunks_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_proposals" ADD CONSTRAINT "topic_proposals_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_proposals" ADD CONSTRAINT "topic_proposals_matched_topic_id_topics_id_fk" FOREIGN KEY ("matched_topic_id") REFERENCES "public"."topics"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_proposals" ADD CONSTRAINT "topic_proposals_resolved_topic_id_topics_id_fk" FOREIGN KEY ("resolved_topic_id") REFERENCES "public"."topics"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_sources" ADD CONSTRAINT "topic_sources_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_sources" ADD CONSTRAINT "topic_sources_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "jobs_status_created" ON "jobs" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "source_chunks_source_ordinal" ON "source_chunks" USING btree ("source_id","ordinal");--> statement-breakpoint
CREATE INDEX "topic_proposals_source" ON "topic_proposals" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "topic_sources_source" ON "topic_sources" USING btree ("source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "topics_name_lower" ON "topics" USING btree (lower("name"));--> statement-breakpoint
-- Sources added before background processing existed get processed by the job runner.
INSERT INTO "jobs" ("kind", "payload", "created_at") SELECT 'process_source', jsonb_build_object('sourceId', "id"), now() FROM "sources";
