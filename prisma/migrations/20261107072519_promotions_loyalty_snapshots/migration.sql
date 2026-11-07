-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "billDiscount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "billPromotionId" UUID,
ADD COLUMN     "billPromotionName" TEXT;

-- AlterTable
ALTER TABLE "SaleItem" ADD COLUMN     "promotionName" TEXT;

-- CreateIndex
CREATE INDEX "Sale_billPromotionId_idx" ON "Sale"("billPromotionId");

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_billPromotionId_fkey" FOREIGN KEY ("billPromotionId") REFERENCES "Promotion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CHECK: ส่วนลดทั้งบิลไม่ติดลบและไม่เกินส่วนลดรวม
ALTER TABLE "Sale" ADD CONSTRAINT sale_bill_discount_range CHECK ("billDiscount" >= 0 AND "billDiscount" <= "discountTotal");
