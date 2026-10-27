-- CreateEnum
CREATE TYPE "FormShareRole" AS ENUM ('RESPONDER', 'EDITOR', 'VIEWER');
CREATE TYPE "FormShareStatus" AS ENUM ('PENDING', 'ACCEPTED');

-- CreateTable
CREATE TABLE "FormShare" (
    "id" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "userId" TEXT,
    "role" "FormShareRole" NOT NULL,
    "status" "FormShareStatus" NOT NULL DEFAULT 'PENDING',
    "token" TEXT NOT NULL,
    "invitedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),
    CONSTRAINT "FormShare_pkey" PRIMARY KEY ("id")
);

-- Indexes / constraints
-- (No FormShare_token_idx: the unique index below is the only token index.)
CREATE UNIQUE INDEX "FormShare_token_key" ON "FormShare"("token");
CREATE UNIQUE INDEX "FormShare_formId_email_key" ON "FormShare"("formId", "email");
CREATE INDEX "FormShare_formId_idx" ON "FormShare"("formId");
CREATE INDEX "FormShare_userId_idx" ON "FormShare"("userId");

-- Foreign keys
ALTER TABLE "FormShare" ADD CONSTRAINT "FormShare_formId_fkey"
    FOREIGN KEY ("formId") REFERENCES "Form"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FormShare" ADD CONSTRAINT "FormShare_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FormShare" ADD CONSTRAINT "FormShare_invitedById_fkey"
    FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
