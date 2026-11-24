CREATE TABLE "suggested_edit_failures" (
	"topic_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"failed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "suggested_edit_failures_topic_id_source_id_pk" PRIMARY KEY("topic_id","source_id")
);
--> statement-breakpoint
ALTER TABLE "suggested_edit_failures" ADD CONSTRAINT "suggested_edit_failures_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggested_edit_failures" ADD CONSTRAINT "suggested_edit_failures_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;