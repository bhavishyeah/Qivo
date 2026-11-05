-- CreateTable
CREATE TABLE "FormDraft" (
    "id" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "answers" JSONB NOT NULL,
    "email" TEXT,
    "currentSection" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FormDraft_pkey" PRIMARY KEY ("id")
);

-- Unique constraint (the resume token)
CREATE UNIQUE INDEX "FormDraft_token_key" ON "FormDraft"("token");

-- Indexes
CREATE INDEX "FormDraft_formId_idx" ON "FormDraft"("formId");
CREATE INDEX "FormDraft_expiresAt_idx" ON "FormDraft"("expiresAt");

-- Foreign key (cascade delete with the form)
ALTER TABLE "FormDraft" ADD CONSTRAINT "FormDraft_formId_fkey"
    FOREIGN KEY ("formId") REFERENCES "Form"("id") ON DELETE CASCADE ON UPDATE CASCADE;
