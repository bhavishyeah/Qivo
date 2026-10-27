-- Standalone: adding a value to the existing NotificationType enum.
-- Must be its own migration so it is NOT wrapped in a transaction with
-- dependent DDL (Postgres forbids ALTER TYPE ... ADD VALUE inside a tx on
-- PG < 12, and forbids using the new value in the same tx on PG >= 12).
ALTER TYPE "NotificationType" ADD VALUE 'FORM_SHARED';
