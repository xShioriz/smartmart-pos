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

## 2026-11-07 — Day 4 (Inventory, Batch, FEFO, Notification v1)
- `stock.consumeFefo`: เลือกล็อตด้วย `SELECT … FOR UPDATE` เรียง `expiryDate ASC NULLS LAST, receivedAt ASC, id` ข้ามล็อตที่ `expiryDate < วันนี้ (เวลาไทย)` (หมดอายุวันนี้ยังขายได้ถึงสิ้นวัน) → คำขอพร้อมกันบนสินค้าเดียวกันถูกจัดคิวที่ DB; ผู้เรียกที่ตัดหลายสินค้าต้องเรียงตาม productId (Day 5)
- ไม่พอ → `InsufficientStockError` (ผู้เรียกปล่อยให้ transaction rollback); movement ต่อล็อต, balanceAfter ต่อเนื่อง, `stockQty` = Σ remainingQty
- `adjustBatch`: ADD/SET ที่ทำให้ยอดเพิ่มจะเพิ่ม `initialQty` ตามส่วนต่าง (เพื่อรักษา CHECK `remainingQty <= initialQty`); ต้องมีเหตุผลทุกครั้ง; ล็อกแถวก่อนแก้
- สต็อกหมดอายุยังนับใน `stockQty` แต่ "ขายได้" (sellable) ไม่รวม; ADMIN ตัดทิ้งด้วยการปรับสต็อก
- Notification: ไม่มีวันที่ใน dedupeKey (แจ้งครั้งเดียวต่อเหตุการณ์) และลบแถวเมื่อเงื่อนไขหมดไปเพื่อให้แจ้งใหม่ได้; `syncNotifications()` เรียกหลังรับเข้า/ปรับ และเมื่อ ADMIN เปิดหน้าคลัง/layout (throttle 5 นาทีต่อ instance, best-effort — ไม่มี cron)
- กระดิ่งใน Topbar (ADMIN) พาไปแท็บ "แจ้งเตือน" ในหน้าคลังสินค้า; Notification Center แยกหน้าเป็นงาน Day 8
- CASHIER: ดูคงเหลือ/ล็อตได้ แต่ไม่เห็นต้นทุน ไม่เห็นประวัติ/แจ้งเตือน และปรับสต็อกไม่ได้ (ตรวจฝั่ง server)
- กรอง "ใกล้หมด" ทำใน JS (จำนวนสินค้าระดับร้านเดียว); ไม่มี pagination ในแท็บคงเหลือ
- ตัวเลข "ใกล้หมดอายุ" ใช้ `near_expiry_days` ใน SystemSetting (ค่าเริ่มต้น 30)
- เทสต์: stock.test.ts 14 เคส (FEFO, ล็อตหมดอายุ, rollback หลายสินค้า, พร้อมกัน 2 และ 6 คำขอ, ปรับสต็อก, notification) + guard script 40 ข้อ (รันด้วย `BASE_URL=http://localhost:3101` ถ้าพอร์ต 3000 ถูกใช้)

## 2026-11-07 — Day 5 (POS + Checkout เงินสด + ใบเสร็จ + ประวัติการขายพื้นฐาน)
- Checkout รับเฉพาะ `{idempotencyKey, items[{productId, quantity}], amountPaid}`; ราคา/ยอด/ส่วนลดคำนวณจาก DB ใน `pricing.calculateCart` (pure; ส่วนลด = 0 จนกว่า Day 6) — payload ที่เกิน (price/total) ถูกทิ้ง ทดสอบแล้วผ่าน HTTP จริง
- ลำดับใน transaction เดียว: Sale(PENDING_PAYMENT) → ตัด FEFO ทีละสินค้า (เรียง productId กัน deadlock) + SaleItem(snapshot, unitCost=ถัวเฉลี่ยจากล็อตที่ตัดจริง) + SaleItemBatch → Payment(CASH, PAID) → Sale=COMPLETED + `receiptNo` (`SM-yyyyMMdd(เวลาไทย)-saleNo 5 หลัก`; saleNo เป็น sequence ทั้งระบบ จึงเว้นช่วงได้ แต่ไม่ซ้ำ)
- Idempotency: key ซ้ำ → คืนบิลเดิม; 2 คำขอ key เดียวพร้อมกัน → ตัวที่แพ้ชน unique แล้วคืนบิลของตัวที่ชนะ (ตัดสต็อกครั้งเดียว); key ของแคชเชียร์อื่นใช้ไม่ได้
- Payment ของเงินสดบันทึก `environment = PRODUCTION` (เงินสดไม่ผ่าน Provider จึงไม่ใช่ sandbox)
- แจ้งเตือนสต็อกหลังขายรันด้วย `after()` ใน Server Action (ไม่อยู่ใน transaction ขาย; ล้มเหลวไม่กระทบการขาย)
- POS: ตะกร้าเก็บใน localStorage (ปรับตามสต็อกปัจจุบันตอนโหลด), ยอดฝั่ง client คิดเป็นสตางค์จำนวนเต็มเพื่อแสดงผลเท่านั้น, key ใหม่เมื่อตะกร้าเปลี่ยน, F2 โฟกัสค้นหา, Enter = สแกน/พิมพ์ SKU-บาร์โค้ดตรงเป๊ะแล้วเพิ่มลงตะกร้า
- ใบเสร็จ: CASHIER ดูได้เฉพาะบิลตนเอง (บิลคนอื่น = 404 ไม่เปิดเผยว่ามี); พิมพ์ด้วย `window.print()` + CSS 80 มม. (ซ่อน sidebar/topbar)
- /sales: ค้นด้วยเลขที่ใบเสร็จ + กรองวัน (เวลาไทย) + แบ่งหน้า; CASHIER เห็นเฉพาะบิลตนเอง; หน้ารายละเอียดบิลแยกเป็นงาน Day 7 (ตอนนี้ลิงก์ไปใบเสร็จ)
- เทสต์: checkout.test.ts 14 เคส (ขายสำเร็จ/ข้ามล็อต/snapshot/rollback/ซ้ำ/พร้อมกัน/deadlock/หมดอายุ/Zod) รวม 43 เคส + guard script รวม POS/ใบเสร็จ/ประวัติการขายผ่าน HTTP
- ยังไม่ได้ตรวจด้วยตา: หน้า POS/ใบเสร็จ/พิมพ์ (ล็อกอินในเบราว์เซอร์ไม่ได้) → ต้องทดสอบมือก่อนถือว่า Day 5 เสร็จ

## 2026-11-07 — Day 6 (PromptPay QR ผ่าน Opn Payments Sandbox)
- โครง: `payments/{types,config,opn,registry}.ts` (adapter) + `services/payments.ts` + `/api/webhooks/payment`; เปลี่ยน Provider = เขียน adapter ใหม่
- **PAID ได้ทางเดียว:** `confirmPaid()` ซึ่งถูกเรียกหลัง `reconcilePayment()` ดึง Charge จาก Provider API เอง และตรวจ chargeId / ยอด (สตางค์) / THB / livemode ตรงกับ environment ของ Payment / metadata.paymentId — webhook เป็นแค่สัญญาณ ไม่เชื่อ body (ทดสอบ: webhook อ้างว่าสำเร็จแต่ Provider บอก pending → ไม่ PAID)
- Idempotent: WebhookEvent unique ที่ event id (ซ้ำ+เสร็จแล้ว = ตอบ 200 ไม่ทำซ้ำ; ซ้ำแต่ยังไม่เสร็จ = ทำต่อ) + `updateMany … WHERE status IN (PENDING, EXPIRED, FAILED)` เป็นประตูเดียว → webhook/reconcile พร้อมกันหลายตัวปิดบิลครั้งเดียว
- ไม่จองสต็อกระหว่างรอ: ตรวจเบื้องต้นตอนสร้าง QR, ตรวจจริง+ตัดตอนได้รับเงิน (ล็อกแถวก่อนตรวจทุกสินค้า แล้วค่อยตัด — ไม่มีการตัดครึ่งๆกลางๆ); ไม่พอ → `PAID_NEEDS_REVIEW` (amountPaid=ยอดบิล เพื่อผ่าน CHECK) + แจ้งเตือน PAYMENT_REVIEW → ADMIN เลือก "ตัดสต็อกและปิดบิล" (หลังเติมสต็อก) หรือ "คืนเงินแล้ว" (โอนคืนนอกระบบ) พร้อมหมายเหตุ + audit
- **บั๊กที่เทสต์จับได้:** ตั้ง `PAID_NEEDS_REVIEW` แล้วชน CHECK `sale_paid_enough` (amountPaid=0 < total) → แก้โดยตั้ง amountPaid=total
- จ่ายล่าช้า (หลัง EXPIRED/FAILED/ยกเลิกโดยแคชเชียร์): ถ้า Provider ยืนยันว่าสำเร็จ ระบบรับเงินและปิดบิล (หรือส่งตรวจสอบถ้าสต็อกไม่พอ) — เงินเข้าแล้วต้องไม่หายจากระบบ
- Provider ยกเลิก PromptPay charge ไม่ได้ (ไม่มี expire/void) → "ยกเลิก QR" = ยกเลิกฝั่งเรา (Payment FAILED, reason CANCELLED_BY_CASHIER, บิล CANCELLED) QR เดิมสแกนจ่ายได้จนหมดเวลา (ค่าเริ่มต้น 10 นาที; ตั้ง `qr_expire_minutes` ใน SystemSetting ได้)
- ยอด QR ต้อง 20–150,000 บาท (ข้อจำกัดของ Provider)
- ไม่มี cron: หน้า POS poll ทุก 2.5 วินาที และเซิร์ฟเวอร์ reconcile กับ Provider ไม่ถี่เกิน 5 วินาทีต่อรายการ (สำรองเมื่อ webhook ไม่มา/ช้า — Omise ไม่รับประกัน retry); กลับมาทำรายการที่ค้างได้หลังรีเฟรช (localStorage) และห้ามปิดหน้าต่างชำระเงินขณะรอ QR (ต้องกดยกเลิก)
- Sandbox/Production: `PAYMENT_ENV` + key แยก; sandbox ต้อง `skey_test_`; production ต้อง live key และต้องเป็น deployment production จริง (Preview/dev = sandbox เท่านั้น) ไม่เช่นนั้น throw; `Payment.environment` เก็บทุกรายการ; แสดงป้าย SANDBOX บนหน้า QR, ใบเสร็จ (เฉพาะ QR) และรายละเอียดบิล
- ไม่มีปุ่ม/endpoint จำลองจ่ายในแอป; `FakeProvider` อยู่เฉพาะในไฟล์เทสต์ (และสลับได้เฉพาะ NODE_ENV=test); ทดสอบ Sandbox จริงด้วย `scripts/smoke-sandbox-qr.mts` ซึ่งใช้ `mark_as_paid` / `mark_as_failed` ของ Provider (มีเฉพาะ test mode)
- Webhook secret (`PAYMENT_WEBHOOK_SECRET`, base64): ถ้าตั้ง → ตรวจ HMAC + timestamp ±5 นาที; ถ้าไม่ตั้ง → ตรวจลายเซ็นไม่ได้ (พึ่งการดึง Charge จาก API ซึ่งทำเสมอ)
- ผลทดสอบ: vitest 66 เคส (payments 23 เคส) + guard script 63 ข้อ + smoke test กับ Sandbox จริงผ่าน (สร้าง QR, ตรวจ charge, STILL_PENDING, mark_as_failed → MARKED_FAILED, mark_as_paid → CONFIRMED + ตัดสต็อก)
- ยังไม่ได้ทดสอบ: webhook ยิงจริงจาก Provider ไปยัง URL สาธารณะ (ต้องตั้งบน Vercel), หน้าจอ QR ด้วยตา, การคืนเงินบิล QR (Day 8 — โอนคืนนอกระบบ)

### Checkpoint Day 6 — ผ่าน (2026-11-07)
- ทดสอบบน Vercel (`smartmart-pos-sage.vercel.app`) กับ Opn Sandbox: ขาย QR → Mark as successful ที่ Dashboard → บิลปิดสำเร็จ และรายละเอียดบิลแสดง "ยืนยันโดย: Webhook จาก Provider" (ผู้ใช้ยืนยันด้วยตา) = webhook ถึงจริงและผ่านขั้นตอนตรวจกับ Provider API
- ยังไม่ได้ทดสอบบน Vercel: กรณี mark failed / ยกเลิก QR / จ่ายล่าช้า / สต็อกไม่พอ (ทดสอบเฉพาะเทสต์อัตโนมัติและ Sandbox ผ่านสคริปต์)

## 2026-11-07 — Day 7 (โปรโมชั่น + สมาชิก + แต้มสะสม)
- **pricing.calculateCart (pure)**: โปรรายการ (PRODUCT/CATEGORY) ต่อบรรทัดใช้ได้อันเดียว = อันที่ลดมากสุด (เท่ากัน → id น้อยกว่า); PERCENT = % ของยอดบรรทัด, FIXED = บาท **ต่อหน่วย** (ไม่เกินราคาต่อหน่วย); โปรทั้งบิล (BILL) ใช้ได้อันเดียว คิดจากยอดหลังลดรายการ ต้องถึงขั้นต่ำ; ส่วนลดทั้งบิลกระจายตามสัดส่วนยอดหลังลดรายการเป็นสตางค์ (largest remainder) → Σ billShare = billDiscount เป๊ะ, Σ netTotal = total เสมอ (property test 1,500 ตะกร้าสุ่ม + สลับลำดับต้องได้ผลเดิม)
- ช่วงเวลา: เริ่มรวมขอบ, สิ้นสุดไม่รวมขอบ; ปิดใช้งาน/หมดอายุ/ยังไม่เริ่ม = ไม่ใช้; บิลที่ขายแล้วเก็บ snapshot ชื่อโปรและส่วนลด (SaleItem.promotionName, Sale.billPromotionName/billDiscount)
- ราคา/โปรคำนวณฝั่งเซิร์ฟเวอร์เท่านั้น: หน้า POS เรียก `quoteCart` (ฟังก์ชันเดียวกับ checkout) และส่ง `expectedTotal` ไปด้วย; ถ้าไม่ตรงกับที่คำนวณตอนยืนยัน (ราคา/โปรเปลี่ยน) → `PriceChangedError` ไม่มีผลข้างเคียง แล้วหน้า POS คำนวณใหม่ (ไม่ใช่การเชื่อยอดจาก client — ใช้กันลูกค้าเห็นยอดหนึ่งแต่จ่ายอีกยอด)
- แต้ม: `floor(ยอดสุทธิ / points_per_baht)` (ค่าเริ่มต้น 25) ให้ใน transaction เดียวกับการปิดบิล (เงินสด) หรือตอนปิดบิล QR สำเร็จ/แก้บิลรอตรวจสอบสำเร็จเท่านั้น; อัปเดต Member แบบ atomic increment → ขายพร้อมกันของสมาชิกคนเดียวกันไม่เพี้ยน (ทดสอบ 8 บิลพร้อมกัน); ไม่ให้ซ้ำเมื่อส่งคำขอซ้ำ; rollback ครอบคลุมแต้ม; ยอดซื้อสะสมนับแม้ได้ 0 แต้ม; ยังไม่มีการใช้แต้ม (Redeem ถูกตัดตามแผน v2.1)
- สมาชิก: ADMIN เท่านั้นที่เพิ่ม/แก้/ปิด; CASHIER ค้นหาที่ POS ได้ (เห็นเฉพาะรหัส ชื่อ เบอร์ 4 ตัวท้าย แต้ม และเฉพาะสมาชิกที่ใช้งาน); รหัส M0001… ออกด้วย advisory lock (สร้างพร้อมกันไม่ชน); เบอร์ไทย 10 หลักขึ้นต้น 0 และไม่ซ้ำ
- **บั๊กที่เทสต์จับได้ (3):** (1) validator โปรโมชั่น crash เมื่อวันที่ผิดรูปแบบ (superRefine ทำงานแม้ฟิลด์ก่อนหน้าไม่ผ่าน); (2) สร้างสมาชิกพร้อมกันชนรหัสเดียวกัน; (3) regex ของ `expectedTotal` เสีย backslash ตอนเขียนไฟล์ ทำให้ทุกคำขอชำระเงินถูกปฏิเสธ — unit test ไม่เจอ แต่ HTTP guard test เจอ → แก้แล้ว
- เทสต์: pricing 15 + loyalty/promotion integration 17 (ต่อเข้าเงินสดและ QR) → รวม 98 เคส; ในเทสต์ที่ตรวจยอดเงินแน่นอน โปรโมชั่นจริงใน DB ถูกสลับเป็น loader จำลอง (`_setPromotionLoaderForTests`, ใช้ได้เฉพาะ NODE_ENV=test); guard script 83 ข้อ
- Migration `20261107072519_promotions_loyalty_snapshots` (เพิ่มคอลัมน์ snapshot + CHECK billDiscount) apply กับ Neon dev แล้ว — **ต้อง `prisma migrate deploy` กับ prod ตอน Day 10**
- ข้อมูล seed: โปรโมชั่น "ซื้อครบ 300 ลด 20" / "ขนมขบเคี้ยวลด 2 บาท/หน่วย" / "น้ำส้ม 10%" ใช้งานอยู่จริงในฐาน dev → การขายทดลองบนหน้า POS จะเห็นส่วนลดทันที
- ยังไม่ได้ทดสอบด้วยตา: หน้า POS ส่วนส่วนลด/เลือกสมาชิก, หน้าโปรโมชั่น/สมาชิก, ใบเสร็จที่มีส่วนลดและแต้ม

## 2026-11-07 — Day 8 (คืนสินค้า/คืนเงิน, ศูนย์แจ้งเตือน, Audit Log)
- **คืนสินค้า = ADMIN เท่านั้น** (เงินออก + กระทบสต็อก/แต้ม; ตรวจฝั่งเซิร์ฟเวอร์) อ้างอิงบิลเดิม (COMPLETED/PARTIALLY_RETURNED) คืนบางรายการ/บางจำนวนได้
- เงินคืนคิดจาก `SaleItem.netTotal` (หลังส่วนลดรายการ + ส่วนลดทั้งบิลที่กระจายแล้ว) แบบ **สะสม**: `round2(net × คืนสะสม / จำนวน) − ที่คืนไปแล้ว` → คืนทีละชิ้นกี่ครั้งก็ตาม ผลรวม = netTotal เป๊ะ (ทดสอบ 33.33 ÷ 3 และบิลที่มีส่วนลดทั้งบิล: คืนครบ = ยอดที่จ่ายจริง)
- คืนสต็อกเข้า **ล็อตเดิม** ผ่าน `SaleItemBatch.restoredQty` (migration `20261107120000_returns_support`, CHECK 0 ≤ restoredQty ≤ quantity) เริ่มจากล็อตที่ถูกตัดทีหลังสุดใน FEFO; `restock=false` (ของเสีย) คืนเงินแต่ไม่คืนสต็อกและไม่มี movement; movement ประเภท RETURN ผูก saleId + returnId
- แต้ม: หักตามสัดส่วนเงินคืนสะสม `floor(แต้มที่ได้ × เงินคืนสะสม / ยอดบิล)` ลบส่วนที่หักไปแล้ว, ไม่ต่ำกว่า 0 (clamp ที่แต้มคงเหลือ), ลดยอดซื้อสะสม, บันทึก `RETURN_ADJUST` ในบัญชีแต้ม
- กันซ้ำ/พร้อมกัน: ล็อกแถวบิล (`FOR UPDATE`) ตอนคืน + `SaleReturn.idempotencyKey` unique + `UPDATE … WHERE returnedQty = ค่าที่อ่าน` → 2 คำขอคืนทั้งหมดพร้อมกัน สำเร็จ 1 ล้มเหลว 1; key เดิมซ้ำ (แม้พร้อมกัน 3 ตัว) ได้ใบคืนเดียว
- **บิล QR:** ไม่คืนผ่าน Provider (Omise ไม่รองรับคืนเงิน PromptPay) ต้องกรอกหมายเหตุการโอนคืนนอกระบบ (บังคับทั้ง UI และเซิร์ฟเวอร์); บิล PENDING/CANCELLED/PAID_NEEDS_REVIEW คืนไม่ได้
- ใบเลขที่คืน `RT-yyyyMMdd-NNNNN`; Audit `SALE_RETURN` พร้อมรายการ เงิน เหตุผล หมายเหตุ แต้ม; หน้ารายละเอียดบิลมีปุ่มคืน (ตัวอย่างเงินคืน/แต้มจากเซิร์ฟเวอร์สูตรเดียวกับตัวจริง) และประวัติการคืน — ใบคืนเงินแบบพิมพ์ถูกตัดตามแผน v2.1
- **Notification Center:** ย้ายจากแท็บในหน้าคลังเป็นหน้า `/notifications` (ADMIN) มีลิงก์ไปบิลที่ต้องตรวจสอบ/สินค้าที่เกี่ยวข้อง; กระดิ่งชี้มาที่หน้านี้; `/inventory?tab=alerts` redirect มาที่ใหม่
- **Audit Log:** `/audit` (ADMIN) อ่านอย่างเดียว กรองตามเหตุการณ์/ผู้ทำรายการ/ช่วงวัน (เวลาไทย) แบ่งหน้า 30 รายการ ดูก่อน/หลังแบบพับเก็บ; ชื่อเหตุการณ์ภาษาไทยใน `lib/audit-labels.ts`
- Migration ต้องสร้างด้วย `prisma migrate diff` (เพราะ `migrate dev` ไม่ interactive ถามยืนยัน unique constraint) แล้ว `migrate deploy`; ต้อง deploy กับ prod ตอน Day 10 รวมเป็น 3 migration
- เทสต์: returns 17 เคส (รวม 115 เคส) + guard script 94 ข้อ; เทสต์ปรับให้บัญชีแต้มยังสอดคล้องเมื่อจำลองการใช้แต้ม
- ยังไม่ได้ทดสอบด้วยตา: กล่องคืนสินค้า, หน้า /notifications, /audit

## 2026-11-07 — Day 9 (Dashboard, รายงาน, Smart BI, ตั้งค่า, ข้อมูลสาธิต, ทดสอบรวม)
- **นิยามรายงาน** (ระบุไว้ในหัวไฟล์ `services/reports.ts` และบนหน้าจอ): บิลที่นับ = COMPLETED/PARTIALLY_RETURNED/FULLY_RETURNED (รอจ่าย/ยกเลิก/รอตรวจสอบไม่นับ); ยอดขาย = Σ total ตามวันที่ขาย; เงินคืน = Σ refundTotal ตามวันที่คืน; **ยอดขายสุทธิ = ยอดขาย − เงินคืน**; เฉลี่ยต่อบิล = ยอดขาย ÷ บิล (ก่อนหักคืน); กำไรขั้นต้น = Σ(netTotal − ต้นทุนล็อตที่ขายจริง) − Σ(เงินคืน − ต้นทุนของที่คืนเข้าสต็อก)
- **บั๊กเขตเวลา (เทสต์จับได้):** คอลัมน์ DateTime ของ Prisma เป็น `timestamp` ไม่มี tz เก็บ UTC; `col AT TIME ZONE 'Asia/Bangkok'` ตรง ๆ ตีความผิดทิศทางทำให้วันเลื่อน 7 ชม. (บิลเช้ามืดไปตกวันก่อน) → ใช้ `(col AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Bangkok'` ทดสอบด้วยบิล 00:00:10 และ 23:59:30 เวลาไทย เทียบ oracle ที่คำนวณด้วย JS
- **Smart BI = สถิติ/กฎ ไม่ใช่ AI** (ติดป้ายบนหน้าจอ + เปิดดูวิธีคำนวณได้ทุกข้อ): เปรียบเทียบวันนี้-เมื่อวาน (ไม่คิด % ถ้าเมื่อวาน = 0), แนวโน้ม 7 วัน (ถดถอยเชิงเส้น เปลี่ยนแปลง% = slope×(n−1)÷ค่าเฉลี่ย, ±5% = ทรงตัว, ต้องมียอดขาย ≥ 3 วัน มิฉะนั้น "ข้อมูลไม่พอ"), สินค้าขายดี 7 วัน, ควรสั่งเพิ่ม (พอขายน้อยกว่า 7 วัน หรือถึงขั้นต่ำ; แนะนำเพิ่มให้พอ 14 วัน), สินค้าขายช้า (ไม่มียอดขาย 14 วัน), สต็อกใกล้หมดอายุ (มูลค่าตามทุนล็อต) — ฟังก์ชันสถิติเป็น pure + unit test 15 เคส
- Dashboard (7/30 วัน) + รายงาน (เลือกช่วงวันได้ ≤ 366 วัน, วันย้อนกลับ/เกินช่วง → ใช้ 30 วันล่าสุดพร้อมแจ้ง, พารามิเตอร์ขยะไม่ทำให้พัง) + กราฟ Recharts (มีตารางรายวันเป็นข้อมูลสำรอง) — ไม่มี Export (ตัดตามแผน)
- **หน้าตั้งค่า (ADMIN):** ชื่อร้าน/ที่อยู่/เบอร์/ท้ายใบเสร็จ, บาทต่อแต้ม (1–10000), วันเตือนใกล้หมดอายุ (1–365), อายุ QR (2–60 นาที); บันทึกเฉพาะค่าที่เปลี่ยน + audit `SETTINGS_UPDATE`; ไม่มีช่องกรอก/แสดง secret key ของ Provider (อ่านสถานะ Sandbox/Production อย่างเดียว)
- **ข้อมูลสาธิต** `scripts/seed-demo.mts` (`ALLOW_DEMO_SEED=1 npx tsx scripts/seed-demo.mts --days 30`): สร้างบิล **เงินสด** ย้อนหลังผ่าน `checkoutCash` ตัวจริง (ใส่ `at` เพื่อกำหนดเวลาขาย — Server Action ไม่ส่งค่านี้และ Zod ทิ้งฟิลด์ที่ไม่รู้จัก) → โปรโมชั่น/FEFO/แต้ม/เลขใบเสร็จครบ; เติมสต็อกย้อนหลังให้พอ; มีสินค้าขายช้า/แนวโน้มขาขึ้น/วันหยุดขายดี; คืนสินค้าบางบิลของวันนี้; **ไม่สร้างบิล QR** (ต้องยืนยันจาก Provider จริง — สาธิต QR สดกับ Sandbox) — ต้องยืนยันด้วย env เพราะเพิ่มข้อมูลถาวร; **ยังไม่ได้รันกับฐานจริง** (รันเฉพาะในเทสต์ด้วยสินค้า ZZ)
- เทสต์ใหม่: reports 6 (เทียบ oracle), bi 15, workflow 4 (ครบวงจร: สินค้า→โปร→สมาชิก→ขายเงินสด+QR→คืน→ปรับสต็อก→รายงาน/แจ้งเตือน/audit, ข้อมูลสาธิต, ตั้งค่า) รวม **140 เคส**; guard script **111 ข้อ** (รวม Dashboard/รายงาน/ตั้งค่า, ช่วงวันผิดปกติ, ไม่มี secret ในหน้าตั้งค่า)
- ยังไม่ได้ทดสอบด้วยตา: Dashboard, รายงาน (กราฟ), ตั้งค่า

## Day 10 — Production deploy (ในระหว่างดำเนินการ)
- Production = Vercel + Neon branch/project แยกจาก dev; PromptPay ยังเป็น Sandbox (ไม่มี merchant account) ระบุไว้ใน README
- Migration/seed ฐาน production ทำจากเครื่องผู้ใช้ผ่านตัวแปรใน terminal (ชนะ .env) ไม่แก้ .env และไม่ส่ง secret ผ่านแชต
- เพิ่ม `scripts/check-deploy.mts` (ตรวจ env/migration/สต็อก ไม่พิมพ์ค่า secret), `docs/DEPLOY.md`, README ใหม่
- ข้อมูลสาธิตบน production เป็นทางเลือก ต้องผู้ใช้ยืนยันฐานปลายทางเอง
- ผลตรวจ production (ผู้ใช้ทดสอบเอง): login, ขายเงินสด, ขาย QR Sandbox (Mark as paid), คืนสินค้า, dashboard/reports/settings และสิทธิ์ CASHIER ผ่านทั้งหมด
- ปัญหาที่พบตอน deploy: login 500 เพราะยังไม่ได้ migrate ฐาน production (`public.User does not exist`) แก้ด้วย `prisma migrate deploy` + seed; ควรรัน `scripts/check-deploy.mts` ก่อน Redeploy เสมอ

## หลัง v1.0 — ฟีเจอร์เพิ่ม 3 อย่าง (migration 20261108090000_login_throttle_shifts)
- **Login throttle**: ตาราง LoginAttempt (เก็บเฉพาะครั้งที่ล้มเหลว, ล้างเมื่อสำเร็จ, เก็บกวาด > 24 ชม.) ใช้ DB เพราะ Vercel serverless ไม่มี memory ร่วม
  - กฎ: อีเมล+IP ≥ 5 ครั้ง / IP ≥ 30 ครั้ง / อีเมล (ทุก IP) ≥ 25 ครั้ง ในหน้าต่าง 15 นาที — เกณฑ์ต่อ IP ต่ำสุดเพื่อไม่ให้คนอื่นล็อกบัญชีของเราได้ง่าย
  - ถูกบล็อกแล้วไม่ตรวจรหัสผ่านและไม่บันทึกความพยายามเพิ่ม (ไม่ต่ออายุการล็อกไปเรื่อย ๆ); อีเมลที่ไม่มีในระบบถูกปฏิบัติเหมือนกัน (ไม่เปิดเผยว่ามีบัญชี)
  - IP มาจาก x-forwarded-for (Vercel ตั้งให้เอง); ข้อจำกัด: การนับไม่ atomic เต็มรูปแบบ ยิงพร้อมกันมากอาจเกินเกณฑ์เล็กน้อย; ผู้ไม่หวังดีที่รู้อีเมล admin ยังทำให้ admin ล็อกอินไม่ได้จาก IP ของตัวเองเท่านั้น (ไม่ใช่ทุก IP) ยกเว้นยิงจากหลาย IP เกิน 25 ครั้ง
  - audit: LOGIN_LOCKED เฉพาะครั้งที่ทำให้ถูกล็อก
- **CSV export**: route `/reports/export` (ADMIN, GET) ใช้ `salesReport/topProducts` ตัวเดียวกับหน้าจอ; UTF-8+BOM, CRLF, กัน formula injection (ใส่ ' นำหน้าข้อความที่ขึ้นต้นด้วย = + - @ tab CR), ตัวเลขส่งเป็น {num} คงทศนิยม; จำกัด 366 วัน; audit REPORT_EXPORT
- **ปิดกะ/นับเงินสด**: ตาราง Shift; เปิดได้ครั้งละ 1 กะ (partial unique index) ทั้ง ADMIN/CASHIER; ประวัติกะเห็นเฉพาะ ADMIN
  - ควรมี = เงินตั้งต้น + ยอดขายเงินสดในช่วงกะ − เงินคืนของบิลเงินสดตามเวลาคืน; QR ไม่เข้าลิ้นชัก (แสดงเป็นข้อมูล) และเงินคืน QR (โอนนอกระบบ) ไม่หัก
  - ผลต่าง ≠ 0 ต้องมีหมายเหตุ; ปิดแล้วแก้ไม่ได้ (ล็อกแถว FOR UPDATE กันปิดซ้ำ/พร้อมกัน); snapshot ตัวเลขตอนปิด; audit SHIFT_OPEN/SHIFT_CLOSE
  - ไม่บังคับให้เปิดกะก่อนขาย (ไม่แตะลอจิก POS ที่ทดสอบแล้ว); ข้อจำกัด: บิลที่บันทึกพอดีช่วงปิดกะอาจตกไปอีกกะ
- ทดสอบ: vitest 168 เคส (เพิ่ม 28: throttle 13, csv 6, shifts 9) + guard HTTP เพิ่มหัวข้อ 4h; ทดสอบ throttle ผ่านหน้าล็อกอินจริงบน production build ด้วยอีเมลสมมติ (ผิด 5 ครั้ง ครั้งที่ 6 ถูกบล็อก)

## Responsive (มือถือ/iPad)
- เกณฑ์: < 768px (phone) = เมนูลิ้นชัก (☰) ไม่มีแถบข้าง; ≥ 768px = แถบข้างแบบไอคอน (ขยายเป็นมีชื่อเมนูที่ ≥ 1280px) — iPad แนวนอน 1024px จึงเหลือพื้นที่ให้ POS มากขึ้น
- POS: < 1024px ตะกร้าเป็นแผงเต็มจอเปิดจากแถบสรุปล่างจอ (ใช้ซ้ำ <aside> เดิม ไม่แตะลอจิกขาย/ชำระเงิน); ≥ 1024px สองคอลัมน์เหมือนเดิม
- จอสัมผัส (pointer: coarse): ปุ่ม/ช่องกรอกสูง ≥ 40px; Dialog เลื่อนได้ (max-h 100dvh)
- ตารางข้อมูล: จอ < 640px ซ่อนคอลัมน์รอง (products/sales/inventory/members/promotions/categories) ด้วย CSS เท่านั้น ข้อมูลครบบนจอใหญ่; ตารางอื่น (รายงาน ประวัติสต็อก audit ผู้ใช้) ยังเลื่อนซ้าย-ขวาในกรอบตาราง
- ตรวจ: ทุกหน้าหลังล็อกอิน 13 หน้าที่ 375px ไม่มี horizontal scroll ระดับหน้า; ดูภาพจริงที่ 375/768/1024 สำหรับ POS ตะกร้า ชำระเงิน เมนู สินค้า ประวัติการขาย รายงาน; ยังไม่ได้ลองบนอุปกรณ์จริง (iOS Safari / iPad) — ต้องทดสอบหลัง deploy
- เพิ่ม scripts/reset-dev-password.mjs (อ่านเฉพาะ .env จึงไม่แตะ production)

## เรียงลำดับตารางด้วยการกดหัวคอลัมน์ (v1.4)
- กดหัวคอลัมน์ = ลิงก์ธรรมดา `?sort=<key>&dir=asc|desc` (ไม่ใช้ JS ฝั่ง client); กดซ้ำสลับทิศ; ตัวเลขกดครั้งแรกเรียงมากไปน้อย; ค่า sort ที่ไม่รู้จักตกกลับเป็นค่าเริ่มต้น (whitelist ต่อหน้า) และเปลี่ยนเรียง = กลับหน้า 1
- หน้าที่มีการแบ่งหน้า (สินค้า ประวัติการขาย สมาชิก ประวัติสต็อก) เรียงฝั่ง server ทั้งชุดก่อนตัดหน้า จึงไม่เรียงแค่ 20 แถวบนจอ; หน้าคงเหลือ (ไม่แบ่งหน้า) เรียงในแอป
- ข้อความไทยเรียงตามพจนานุกรม (`Intl.Collator("th")` — สระนำ เ แ โ ไ ไม่นับ) เพราะ DB ของเราเรียงตามรหัสอักขระ (พบจริง: "เครื่องดื่ม" ไปอยู่ท้ายสุด) จึงดึงเฉพาะ id+ข้อความของแถวที่ตรงเงื่อนไขมาเรียงในแอปแล้วค่อยดึงรายละเอียดเฉพาะหน้านั้น (ใช้กับ ชื่อ/หมวดหมู่สินค้า, ชื่อสมาชิก, คงเหลือ) ข้อแลกเปลี่ยน: ต้องอ่านทั้งชุดที่ตรงเงื่อนไข ซึ่งพอสำหรับร้านขนาด 10^2–10^4 รายการ
- สถานะสต็อกเรียงตามความเร่งด่วน (หมด → มีล็อตหมดอายุ → ใกล้หมด → ใกล้หมดอายุ → ปกติ); วันหมดอายุที่ว่างอยู่ท้ายเสมอทั้งสองทิศ
- หน้าที่ยังไม่ทำ: ตารางเล็กที่ไม่แบ่งหน้า (หมวดหมู่ โปรโมชัน ผู้ใช้ กะ audit รายงาน)
- ทดสอบ: vitest 177 เคส (เพิ่ม 9 ใน `src/lib/__tests__/sort.test.ts`) + ตรวจผ่านเบราว์เซอร์บน dev (เรียงทุกคอลัมน์หลักของคลัง/ประวัติสต็อก/สินค้า/ประวัติขาย/สมาชิก ข้ามทุกหน้า ตรวจ 44 สินค้าไม่ซ้ำไม่ขาด)
