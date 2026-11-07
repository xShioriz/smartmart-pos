# DECISIONS

| วันที่ | การตัดสินใจ | เหตุผล |
|---|---|---|
| 2026-11-03 | อนุมัติแผน v2.1 (Full Features + PromptPay QR ผ่าน Provider, Sandbox ก่อน) | ผู้ใช้อนุมัติ |
| 2026-11-03 | Session แบบเขียนเอง (jose + bcryptjs) แทน Auth.js | Auth.js v5 เสี่ยงเรื่องเวอร์ชัน/adapter; ใช้แค่ credentials |
| 2026-11-03 | สต็อกอยู่ที่ `ProductBatch` (ทุกสินค้ามี batch, expiryDate = null ได้); `Product.stockQty` เป็น cache | FEFO เส้นทางเดียว |
| 2026-11-03 | Prisma 6.x (ไม่ใช้ 7) และ `@types/node@22` | Prisma 7 ยังไม่ผ่านการประเมิน; vitest 5 ต้องการ @types/node ≥22 |
| 2026-11-03 | โปรเจกต์อยู่ใน `smartmart-pos/` (ชื่อโฟลเดอร์เดิมมีช่องว่างทำให้ชื่อแพ็กเกจไม่ถูกต้อง) | create-next-app |
| 2026-11-03 | ค่าตั้งต้นที่ยังไม่ได้รับคำตอบจากผู้ใช้ (ใช้ตามข้อเสนอในแผน, แก้ได้): หมดอายุ=ขายไม่ได้ตั้งแต่วันถัดไป, 1 แต้ม/25 บาท, โปรไม่ stack, ปี ค.ศ., CASHIER เห็นประวัติของตนเอง | รอยืนยัน |
| 2026-11-03 | Provider QR: ข้อเสนอ Opn Payments — **ยังไม่ยืนยัน** รอ Provider Spike (ต้องมี test keys) | |

## สิ่งที่ยังไม่ได้ทดสอบ / ข้อสังเกต
- Next.js 16.4.4 / React 19.3 / Tailwind 4 มาจาก create-next-app; ยังไม่ได้ build
- `npm audit` รายงาน 19 ช่องโหว่ (16 moderate, 3 high) ยังไม่ได้ตรวจว่าเป็น dev-only หรือไม่

## 2026-11-03 — Day 1 (ต่อ)
- ปิด `cacheComponents` และ `partialPrefetching` ใน `next.config.ts` (scaffold ของ Next 16.4 เปิดมาให้) เพราะทำให้ `export const dynamic` ใช้ไม่ได้และบังคับ Suspense กับข้อมูลแบบ dynamic ทั้งแอป (auth cookie, query DB) — เพิ่มความซับซ้อนโดยไม่จำเป็นกับ POS
- Migration `20261103061909_init` มี CHECK constraints ต่อท้าย (stock/batch/ราคา/แต้ม/ยอดขาย/ใบเสร็จ) — ทดสอบแล้วว่าปฏิเสธค่าผิด
- Neon `dev` ใช้ pooled URL สำหรับแอป และ direct URL สำหรับ migrate

## 2026-11-03 — Provider Spike (Opn Payments / Omise) — ผ่าน (Sandbox)
ยืนยันจากเอกสาร docs.omise.co และเรียก API จริงด้วย test key:
- `GET /account` → test mode (`livemode=false`), THB, TH
- `POST /charges` ด้วย `source[type]=promptpay` + `expires_at` → 200, `status=pending`, มี QR ที่ `source.scannable_code.image.download_uri` (บัญชีทดสอบเปิด PromptPay แล้ว)
- จำนวนเงินเป็น **สตางค์** (จำกัด 20.00–150,000.00 บาท); QR default หมดอายุ 24 ชม. → เราตั้ง `expires_at` ≈ 10 นาทีต่อ charge (ไม่เกิน 24 ชม.)
- สถานะ charge: `pending | successful | failed | expired`
- **PromptPay void/refund ผ่าน Omise ไม่ได้** → ตรงกับแผน: คืนเงินบิล QR เป็นการโอนคืนนอกระบบ
- Test mode: จำลองจ่ายสำเร็จ/ล้มเหลวด้วยมือที่ Dashboard (Actions → Successful/Failed)
- Webhook: event `charge.complete`; เซ็นด้วย HMAC-SHA256 ถ้าตั้ง webhook secret (headers `Omise-Signature`, `Omise-Signature-Timestamp`; signed string = timestamp + "." + raw body; secret เป็น base64); **ไม่รับประกัน retry** → ต้องมี reconcile/polling เป็น fallback (อยู่ในแผนแล้ว)
- ต้องทำเมื่อไป Production: ขอเปิด PromptPay ที่ support + ยอมรับเงื่อนไข (ต้องมี Merchant ที่ผ่านการยืนยัน)
- ข้อมูลยังไม่ได้ทดสอบ: การยิง webhook จริงจาก Dashboard ไปยัง URL สาธารณะ (ทำ Day 6/10)
- ชาร์จทดสอบ spike 1 รายการ (20 บาท, metadata.spike=true) ถูกสร้างใน Sandbox ปล่อยให้หมดอายุเอง

## 2026-11-07 — Day 2 (Auth, Layout, Users)
- Next 16: `middleware` → `proxy.ts` (ตรวจแค่ cookie ลงชื่อถูกต้องหรือไม่); การตรวจสิทธิ์จริงอยู่ที่ `requirePage()` / `requireAction()` ซึ่งโหลดผู้ใช้จาก DB ทุกคำขอ → ปิดบัญชี/เปลี่ยน role มีผลทันที
- เพราะมี `loading.tsx` หน้าที่ถูก redirect จาก requirePage จะตอบ HTTP 200 พร้อม NEXT_REDIRECT ในสตรีม (เบราว์เซอร์ถูกพาไปหน้าใหม่) — ตรวจแล้วว่าไม่มีข้อมูลหน้านั้นรั่วในเนื้อหา
- shadcn รุ่นนี้ใช้ base-ui (ไม่ใช่ radix) และแพ็กเกจ `cn` (shadcn-ui/cn); ธีมเขียว `oklch(0.627 0.194 149.214)`, ฟอนต์ Noto Sans Thai
- ไม่มี rate limit ที่ login (ข้อจำกัดที่ยอมรับใน MVP); login ล้มเหลวบันทึก `LOGIN_FAILED` ใน AuditLog
- เมนูที่ยังไม่พัฒนาแสดง "เร็ว ๆ นี้" (ปิดการคลิก) และหน้า /dashboard /pos เป็น placeholder ที่ระบุชัดว่ายังไม่พร้อม
- สคริปต์ `scripts/test-auth-guards.mjs` ทดสอบ guard + server action ด้วยคำขอจริง

## 2026-11-07 — Day 3 (Category + Product)
- สต็อกเริ่มต้นตอนสร้างสินค้า = batch แรก (`INIT-yyyyMMdd-NN`) + StockMovement INITIAL ผ่าน `stock.receiveBatch` (Day 4 ใช้ต่อสำหรับรับเข้า/ปรับสต็อก); สต็อก 0 = ไม่สร้าง batch
- แก้สต็อกจากฟอร์มสินค้าไม่ได้ (ต้องไปหน้าคลังสินค้า Day 4)
- ราคา/ทุนรับเป็นสตริง regex `^\d{1,9}(\.\d{1,2})?$` → Decimal (ไม่ผ่าน float); barcode ว่าง → null
- ไม่มีการลบสินค้า (ปิดใช้งานเท่านั้น); ลบหมวดได้เมื่อไม่มีสินค้า/โปรโมชั่นอ้างอิง
- Audit: CATEGORY_*, PRODUCT_CREATE/UPDATE/PRICE_CHANGE/ENABLE/DISABLE (ไม่บันทึกเมื่อไม่มีการเปลี่ยนค่า)
- ค้นหา/กรอง/แบ่งหน้าเป็นฟอร์ม GET + searchParams (ทำงานไม่ต้องพึ่ง JS); กรอง "ใกล้หมด" เลื่อนไปหน้าคลังสินค้า (Prisma เทียบคอลัมน์กับคอลัมน์ไม่ได้)
- เทสต์: vitest integration ต่อ DB dev (`npm test`, ข้อมูลทดสอบขึ้นต้น ZZTEST และลบเมื่อจบ) + scripts/test-auth-guards.mjs (30 ข้อ)
- ข้อควรระวังตอนทดสอบ: ถ้า `npm run dev` ของผู้ใช้เปิดพอร์ต 3000 อยู่ สคริปต์ที่เปิด `npm start` จะชนกัน (action id ไม่ตรง) — ปิด dev server ก่อนรัน
