-- AlterTable
ALTER TABLE "SaleItemBatch" ADD COLUMN     "restoredQty" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "SaleReturn" ADD COLUMN     "idempotencyKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "SaleReturn_idempotencyKey_key" ON "SaleReturn"("idempotencyKey");


-- CHECK: คืนเข้าล็อตได้ไม่เกินจำนวนที่ตัดจากล็อตนั้น
ALTER TABLE "SaleItemBatch" ADD CONSTRAINT saleitembatch_restored_range CHECK ("restoredQty" >= 0 AND "restoredQty" <= "quantity");
