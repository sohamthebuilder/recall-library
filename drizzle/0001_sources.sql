CREATE TYPE "public"."source_kind" AS ENUM('url', 'youtube', 'pdf', 'markdown', 'note');--> statement-breakpoint
CREATE TABLE "sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "source_kind" NOT NULL,
	"title" text,
	"reference" text,
	"text" text NOT NULL,
	"added_at" timestamp with time zone NOT NULL
);
