/*
  Warnings:

  - You are about to drop the column `published` on the `Form` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "FormStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'PUBLISHED', 'CLOSED', 'ARCHIVED');

-- AlterTable
ALTER TABLE "Form" DROP COLUMN "published",
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "status" "FormStatus" NOT NULL DEFAULT 'DRAFT';

-- CreateIndex
CREATE INDEX "Form_status_idx" ON "Form"("status");

-- CreateIndex
CREATE INDEX "Form_deletedAt_idx" ON "Form"("deletedAt");
