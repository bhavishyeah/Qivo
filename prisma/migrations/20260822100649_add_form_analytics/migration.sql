-- CreateTable
CREATE TABLE "FormAnalytics" (
    "id" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FormAnalytics_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FormAnalytics_formId_event_idx" ON "FormAnalytics"("formId", "event");

-- CreateIndex
CREATE INDEX "FormAnalytics_formId_createdAt_idx" ON "FormAnalytics"("formId", "createdAt");
