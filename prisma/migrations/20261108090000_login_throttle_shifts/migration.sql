-- CreateEnum
CREATE TYPE "ShiftStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateTable
CREATE TABLE "LoginAttempt" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shift" (
    "id" UUID NOT NULL,
    "shiftNo" SERIAL NOT NULL,
    "status" "ShiftStatus" NOT NULL DEFAULT 'OPEN',
    "openedById" UUID NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "openingCash" DECIMAL(12,2) NOT NULL,
    "closedById" UUID,
    "closedAt" TIMESTAMP(3),
    "billCount" INTEGER,
    "cashSales" DECIMAL(12,2),
    "cashRefunds" DECIMAL(12,2),
    "qrSales" DECIMAL(12,2),
    "expectedCash" DECIMAL(12,2),
    "countedCash" DECIMAL(12,2),
    "difference" DECIMAL(12,2),
    "note" TEXT,

    CONSTRAINT "Shift_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LoginAttempt_email_ip_createdAt_idx" ON "LoginAttempt"("email", "ip", "createdAt");

-- CreateIndex
CREATE INDEX "LoginAttempt_ip_createdAt_idx" ON "LoginAttempt"("ip", "createdAt");

-- CreateIndex
CREATE INDEX "LoginAttempt_email_createdAt_idx" ON "LoginAttempt"("email", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Shift_shiftNo_key" ON "Shift"("shiftNo");

-- CreateIndex
CREATE INDEX "Shift_openedAt_idx" ON "Shift"("openedAt");

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ที่เปิดอยู่ได้ทีละ 1 กะเท่านั้น (กันเปิดซ้อนแม้เรียกพร้อมกัน)
CREATE UNIQUE INDEX "shift_only_one_open" ON "Shift" ("status") WHERE "status" = 'OPEN';

-- ความถูกต้องของข้อมูลกะ
ALTER TABLE "Shift" ADD CONSTRAINT "shift_opening_nonneg" CHECK ("openingCash" >= 0);
ALTER TABLE "Shift" ADD CONSTRAINT "shift_counted_nonneg" CHECK ("countedCash" IS NULL OR "countedCash" >= 0);
ALTER TABLE "Shift" ADD CONSTRAINT "shift_closed_complete" CHECK (
  ("status" = 'OPEN' AND "closedAt" IS NULL AND "closedById" IS NULL AND "countedCash" IS NULL)
  OR ("status" = 'CLOSED' AND "closedAt" IS NOT NULL AND "closedById" IS NOT NULL AND "countedCash" IS NOT NULL AND "expectedCash" IS NOT NULL AND "difference" IS NOT NULL)
);
