-- Add per-webhook event subscription. Existing rows default to and are
-- backfilled with the sole pre-existing event so they keep receiving only
-- response.created.

-- AlterTable
ALTER TABLE "Webhook" ADD COLUMN "events" TEXT[] NOT NULL DEFAULT ARRAY['response.created']::TEXT[];

-- Backfill any rows that materialized with an empty array.
UPDATE "Webhook" SET "events" = ARRAY['response.created']::TEXT[] WHERE "events" = '{}';
