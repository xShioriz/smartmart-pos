# แผนภาพประกอบการนำเสนอ

เขียนด้วย Mermaid (แสดงผลอัตโนมัติบน GitHub; ถ้าต้องการใส่สไลด์ ให้วางโค้ดที่ https://mermaid.live แล้ว Export เป็น PNG/SVG)

## 1) Use Case Diagram

```mermaid
flowchart LR
  A([ผู้ดูแลระบบ])
  C([แคชเชียร์])

  subgraph SYS["SmartMart POS"]
    direction TB
    U1(["เข้าสู่ระบบ / ออกจากระบบ"])
    U2(["ขายสินค้า (POS)"])
    U3(["รับชำระเงินสด"])
    U4(["รับชำระ PromptPay QR"])
    U5(["ใช้สมาชิก / แต้ม"])
    U6(["พิมพ์/ดูใบเสร็จ"])
    U7(["ดูประวัติการขาย"])
    U8(["ดูสต็อกคงเหลือ"])
    U9(["เปิด/ปิดกะ นับเงินสด"])
    U10(["จัดการสินค้า / หมวดหมู่"])
    U11(["รับเข้า / ปรับสต็อกราย ล็อต"])
    U12(["จัดการโปรโมชัน"])
    U13(["จัดการสมาชิก"])
    U14(["คืนสินค้า"])
    U15(["ดู Dashboard / รายงาน / Smart BI"])
    U16(["ส่งออก CSV"])
    U17(["จัดการผู้ใช้ / ตั้งค่าระบบ"])
    U18(["ดู Audit Log / การแจ้งเตือน"])
  end

  A ==>|ทำได้ทุกอย่างของแคชเชียร์| C
  C --- U1 & U2 & U6 & U7 & U8 & U9
  U2 -. include .-> U3
  U2 -. include .-> U4
  U2 -. extend .-> U5

  A --- U10 & U11 & U12 & U13 & U14 & U15 & U16 & U17 & U18
```

สิทธิ์: แคชเชียร์เห็นเฉพาะบิลของตนเองและสต็อกแบบอ่านอย่างเดียว; ผู้ดูแลระบบทำได้ทุกอย่าง (บังคับที่ฝั่ง server ทุก Server Action / Route Handler)

## 2) ER Diagram (ตารางหลัก)

แสดงเฉพาะฟิลด์สำคัญ ฐานข้อมูลจริงอยู่ที่ `prisma/schema.prisma`

```mermaid
erDiagram
  USER ||--o{ SALE : "เป็นแคชเชียร์"
  USER ||--o{ SHIFT : "เปิด/ปิดกะ"
  USER ||--o{ AUDIT_LOG : "ทำรายการ"
  USER ||--o{ STOCK_MOVEMENT : "บันทึก"
  USER ||--o{ SALE_RETURN : "รับคืน"

  CATEGORY ||--o{ PRODUCT : "มีสินค้า"
  PRODUCT ||--o{ PRODUCT_BATCH : "มีล็อต"
  PRODUCT ||--o{ STOCK_MOVEMENT : "เคลื่อนไหว"
  PRODUCT ||--o{ SALE_ITEM : "ถูกขาย"
  PRODUCT ||--o{ NOTIFICATION : "แจ้งเตือน"
  PRODUCT_BATCH ||--o{ STOCK_MOVEMENT : "ล็อตที่เคลื่อนไหว"

  MEMBER ||--o{ SALE : "ซื้อ"
  MEMBER ||--o{ POINT_TRANSACTION : "สะสม/ใช้แต้ม"

  PROMOTION ||--o{ SALE_ITEM : "ลดรายการ"
  PROMOTION ||--o{ SALE : "ลดทั้งบิล"

  SALE ||--|{ SALE_ITEM : "ประกอบด้วย"
  SALE ||--o| PAYMENT : "ชำระด้วย"
  SALE ||--o{ SALE_RETURN : "ถูกคืน"
  SALE ||--o{ POINT_TRANSACTION : "ให้แต้ม"
  SALE_ITEM ||--o{ SALE_ITEM_BATCH : "ตัดสต็อกจากล็อต"
  PRODUCT_BATCH ||--o{ SALE_ITEM_BATCH : "ถูกตัด"
  SALE_RETURN ||--|{ SALE_RETURN_ITEM : "คืนรายการ"
  SALE_ITEM ||--o{ SALE_RETURN_ITEM : "ถูกคืน"
  PAYMENT ||--o{ WEBHOOK_EVENT : "ได้รับสัญญาณ"

  USER {
    uuid id PK
    string email UK
    string name
    enum role "ADMIN | CASHIER"
    boolean isActive
  }
  CATEGORY {
    uuid id PK
    string name UK
  }
  PRODUCT {
    uuid id PK
    string sku UK
    string barcode UK
    string name
    decimal costPrice
    decimal price
    int stockQty "cache = SUM ของล็อต"
    int minStock
  }
  PRODUCT_BATCH {
    uuid id PK
    uuid productId FK
    date expiryDate "FEFO"
    int initialQty
    int remainingQty "แหล่งความจริงของสต็อก"
  }
  SALE {
    uuid id PK
    string receiptNo UK
    string idempotencyKey UK "กันบิลซ้ำ"
    enum status
    decimal subtotal
    decimal discountTotal
    decimal total
    enum paymentMethod "CASH | PROMPTPAY"
  }
  PAYMENT {
    uuid id PK
    uuid saleId FK
    enum status
    enum environment "sandbox | production"
    string providerChargeId UK
    decimal amount
  }
  SHIFT {
    int shiftNo
    enum status "OPEN | CLOSED"
    decimal openingCash
    decimal expectedCash
    decimal countedCash
    decimal difference
  }
```

จุดออกแบบที่ควรพูดตอนนำเสนอ
- **สต็อกจริงอยู่ที่ล็อต** (`ProductBatch.remainingQty`) ส่วน `Product.stockQty` เป็นค่าสะสมเพื่อแสดงผลเร็ว และแก้ได้ผ่าน service เท่านั้น
- **ตัดสต็อกแบบ FEFO** (หมดอายุก่อนตัดก่อน) บันทึกว่าตัดจากล็อตไหนใน `SaleItemBatch` จึงคืนสินค้ากลับล็อตเดิมได้
- **ราคา/ส่วนลดเก็บเป็น snapshot** ในบิล (ชื่อโปรโมชัน ราคาต่อหน่วย) เปลี่ยนราคาทีหลังไม่กระทบบิลเก่า
- **`idempotencyKey`** กันกดจ่ายซ้ำ / เน็ตกระตุกแล้วบิลซ้ำ
- **สถานะ Payment เป็น PAID ได้ทางเดียว** คือหลังเรียก API ผู้ให้บริการยืนยันเอง Webhook เป็นเพียงสัญญาณ
- **ความสัมพันธ์หลักใช้ `onDelete: Restrict`** จึงลบสินค้า/ผู้ใช้/สมาชิกที่มีประวัติอ้างอิงไม่ได้ (ใช้ปิดการใช้งานแทน); มีเพียงรายการลูกของบิล (`SaleItem`, `SaleItemBatch`, `SaleReturnItem`) และการแจ้งเตือนที่ลบตามแม่
