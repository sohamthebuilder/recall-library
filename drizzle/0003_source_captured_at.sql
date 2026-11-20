ALTER TABLE "sources" ADD COLUMN "captured_at" timestamp with time zone;--> statement-breakpoint
-- Sources captured before this column existed (Notes) were captured when added.
UPDATE "sources" SET "captured_at" = "added_at" WHERE "text" IS NOT NULL;
