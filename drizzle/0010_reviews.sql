CREATE TYPE "public"."review_kind" AS ENUM('scheduled', 'practice');--> statement-breakpoint
CREATE TYPE "public"."review_rating" AS ENUM('again', 'hard', 'good', 'easy');--> statement-breakpoint
CREATE TABLE "review_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "review_kind" DEFAULT 'scheduled' NOT NULL,
	"prompt_ids" jsonb NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prompt_id" uuid NOT NULL,
	"session_id" uuid,
	"kind" "review_kind" NOT NULL,
	"question" text NOT NULL,
	"answer" text NOT NULL,
	"ai_rating" "review_rating" NOT NULL,
	"rating" "review_rating" NOT NULL,
	"overruled" boolean DEFAULT false NOT NULL,
	"points_covered" jsonb NOT NULL,
	"points_missed" jsonb NOT NULL,
	"explainer_version_id" uuid,
	"relevant_key_point_ids" jsonb NOT NULL,
	"card_before" jsonb NOT NULL,
	"reviewed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_prompt_id_recall_prompts_id_fk" FOREIGN KEY ("prompt_id") REFERENCES "public"."recall_prompts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_session_id_review_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."review_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_explainer_version_id_explainer_versions_id_fk" FOREIGN KEY ("explainer_version_id") REFERENCES "public"."explainer_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "review_sessions_one_open" ON "review_sessions" USING btree ("kind") WHERE "review_sessions"."finished_at" is null;--> statement-breakpoint
CREATE INDEX "reviews_prompt" ON "reviews" USING btree ("prompt_id","reviewed_at");--> statement-breakpoint
CREATE INDEX "reviews_session" ON "reviews" USING btree ("session_id");