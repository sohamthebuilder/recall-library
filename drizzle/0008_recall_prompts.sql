CREATE TYPE "public"."fsrs_card_state" AS ENUM('new', 'learning', 'review', 'relearning');--> statement-breakpoint
CREATE TYPE "public"."recall_prompt_kind" AS ENUM('explain', 'compare', 'apply', 'why');--> statement-breakpoint
CREATE TYPE "public"."recall_prompt_origin" AS ENUM('generated', 'learner_edited', 'learner_written');--> statement-breakpoint
CREATE TYPE "public"."recall_prompt_state" AS ENUM('active', 'suspended', 'retired');--> statement-breakpoint
CREATE TABLE "recall_prompts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"topic_id" uuid NOT NULL,
	"kind" "recall_prompt_kind" NOT NULL,
	"question" text NOT NULL,
	"expected_points" jsonb NOT NULL,
	"origin" "recall_prompt_origin" NOT NULL,
	"state" "recall_prompt_state" DEFAULT 'active' NOT NULL,
	"explainer_version_id" uuid,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"due" timestamp with time zone NOT NULL,
	"stability" double precision,
	"difficulty" double precision,
	"fsrs_state" "fsrs_card_state" DEFAULT 'new' NOT NULL,
	"reps" integer DEFAULT 0 NOT NULL,
	"lapses" integer DEFAULT 0 NOT NULL,
	"learning_steps" integer DEFAULT 0 NOT NULL,
	"last_reviewed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "recall_prompts" ADD CONSTRAINT "recall_prompts_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recall_prompts" ADD CONSTRAINT "recall_prompts_explainer_version_id_explainer_versions_id_fk" FOREIGN KEY ("explainer_version_id") REFERENCES "public"."explainer_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recall_prompts_topic" ON "recall_prompts" USING btree ("topic_id");--> statement-breakpoint
CREATE INDEX "recall_prompts_due" ON "recall_prompts" USING btree ("state","due");