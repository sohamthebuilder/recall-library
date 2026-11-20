CREATE TYPE "public"."explainer_status" AS ENUM('generating', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."explainer_version_cause" AS ENUM('generated', 'instruction', 'text_edit', 'suggested_edit', 'restore', 'form_switch');--> statement-breakpoint
CREATE TABLE "explainer_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"explainer_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"content" jsonb NOT NULL,
	"cause" "explainer_version_cause" NOT NULL,
	"cause_detail" jsonb,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "explainers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"topic_id" uuid NOT NULL,
	"status" "explainer_status" DEFAULT 'generating' NOT NULL,
	"failure_reason" text,
	"current_version_id" uuid,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "explainers_topic_id_unique" UNIQUE("topic_id")
);
--> statement-breakpoint
ALTER TABLE "explainer_versions" ADD CONSTRAINT "explainer_versions_explainer_id_explainers_id_fk" FOREIGN KEY ("explainer_id") REFERENCES "public"."explainers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "explainers" ADD CONSTRAINT "explainers_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "explainers" ADD CONSTRAINT "explainers_current_version_id_explainer_versions_id_fk" FOREIGN KEY ("current_version_id") REFERENCES "public"."explainer_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "explainer_versions_explainer_number" ON "explainer_versions" USING btree ("explainer_id","number");