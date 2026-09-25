-- Make passwordHash optional (Google accounts have no password)
ALTER TABLE "User" ALTER COLUMN "passwordHash" DROP NOT NULL;

-- Add googleId for explicit Google account linking
ALTER TABLE "User" ADD COLUMN "googleId" TEXT;
CREATE UNIQUE INDEX "User_googleId_key" ON "User"("googleId");

-- Add respondentEmail on FormResponse for DB-level single-response enforcement.
-- NULLs are distinct in Postgres unique indexes, so anonymous / multi-response
-- submissions (respondentEmail = NULL) are unaffected.
ALTER TABLE "FormResponse" ADD COLUMN "respondentEmail" TEXT;
CREATE UNIQUE INDEX "FormResponse_formId_respondentEmail_key" ON "FormResponse"("formId", "respondentEmail");
