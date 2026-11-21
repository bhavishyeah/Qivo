-- CreateEnum
CREATE TYPE "FormReportReason" AS ENUM ('SCAM', 'SPAM', 'IMPERSONATION', 'OTHER');

-- CreateEnum
CREATE TYPE "FormReportStatus" AS ENUM ('OPEN', 'REVIEWED', 'DISMISSED');

-- AlterTable
ALTER TABLE "Form" ADD COLUMN     "flaggedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "FormReport" (
    "id" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "reason" "FormReportReason" NOT NULL,
    "details" TEXT,
    "reporterEmail" TEXT,
    "ipHash" TEXT NOT NULL,
    "userAgent" TEXT,
    "status" "FormReportStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,

    CONSTRAINT "FormReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FormReport_formId_idx" ON "FormReport"("formId");

-- CreateIndex
CREATE INDEX "FormReport_status_idx" ON "FormReport"("status");

-- AddForeignKey
ALTER TABLE "FormReport" ADD CONSTRAINT "FormReport_formId_fkey" FOREIGN KEY ("formId") REFERENCES "Form"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormReport" ADD CONSTRAINT "FormReport_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
