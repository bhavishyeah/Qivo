-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('created', 'paid', 'verified', 'failed');

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "responseId" TEXT,
    "razorpayOrderId" TEXT NOT NULL,
    "razorpayPaymentId" TEXT,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "status" "PaymentStatus" NOT NULL DEFAULT 'created',
    "notes" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- Unique constraints
CREATE UNIQUE INDEX "Payment_responseId_key" ON "Payment"("responseId");
CREATE UNIQUE INDEX "Payment_razorpayOrderId_key" ON "Payment"("razorpayOrderId");
CREATE UNIQUE INDEX "Payment_razorpayPaymentId_key" ON "Payment"("razorpayPaymentId");

-- Indexes
CREATE INDEX "Payment_formId_idx" ON "Payment"("formId");
CREATE INDEX "Payment_status_idx" ON "Payment"("status");

-- Foreign keys
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_formId_fkey"
    FOREIGN KEY ("formId") REFERENCES "Form"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_responseId_fkey"
    FOREIGN KEY ("responseId") REFERENCES "FormResponse"("id") ON DELETE SET NULL ON UPDATE CASCADE;
