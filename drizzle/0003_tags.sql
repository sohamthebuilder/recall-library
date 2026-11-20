CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "topic_tags" (
	"topic_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "topic_tags_topic_id_tag_id_pk" PRIMARY KEY("topic_id","tag_id")
);
--> statement-breakpoint
ALTER TABLE "topic_tags" ADD CONSTRAINT "topic_tags_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_tags" ADD CONSTRAINT "topic_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tags_name_lower" ON "tags" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "topic_tags_tag" ON "topic_tags" USING btree ("tag_id");