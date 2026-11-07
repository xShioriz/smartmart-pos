# SmartMart POS

ระบบ POS สำหรับร้านสะดวกซื้อ (โปรเจกต์จบการศึกษา) — ขายหน้าร้าน สต็อกแบบล็อต/FEFO สมาชิกและแต้ม โปรโมชั่น คืนสินค้า รายงาน และ Smart BI แบบกฎ/สถิติ (ไม่ใช้ AI)

Stack: Next.js 16 (App Router) · TypeScript · Tailwind 4 · shadcn/ui · Prisma 6 · PostgreSQL (Neon) · Zod · Recharts

## ฟีเจอร์
- **ขาย (POS)**: เงินสด และ PromptPay QR ผ่าน Opn Payments (Omise) — ยืนยันการจ่ายจาก Provider เท่านั้น
- **สต็อก**: รับเข้า/ปรับสต็อกเป็นล็อต, ตัดแบบ FEFO, วันหมดอายุ, แจ้งเตือน
- **สมาชิก/แต้ม** และ **โปรโมชั่น** (ลดรายการ/ลดทั้งบิล คำนวณฝั่ง server)
- **คืนสินค้า** (ADMIN) คืนสต็อกเข้าล็อตเดิม และกลับรายการแต้ม
- **แดชบอร์ด / รายงาน / Smart BI** (แนวโน้ม ควรสั่งเพิ่ม สินค้าขายช้า ใกล้หมดอายุ — แสดงวิธีคำนวณทุกข้อ)
- **ผู้ใช้ 2 สิทธิ์** (ADMIN, CASHIER), **Audit log**, **ตั้งค่าร้าน**

## ข้อจำกัดที่ต้องทราบ
- PromptPay ใช้ **Sandbox** เท่านั้น (การรับเงินจริงต้องมี merchant account กับ Provider)
- ไม่มีการกันสต็อกระหว่างรอลูกค้าสแกน QR (ตรวจสต็อกอีกครั้งตอนยืนยันการจ่าย)
- การคืนเงินบิล QR ต้องโอนคืนนอกระบบ (Provider ไม่รองรับ refund PromptPay) ระบบบันทึกหมายเหตุไว้
- Webhook ของ Provider ไม่รับประกันการส่งซ้ำ จึงมี reconcile สำรอง
- ยังไม่มี rate limit การล็อกอิน

## เริ่มใช้งานในเครื่อง
```bash
npm install
cp .env.example .env     # กรอกค่าเอง ห้าม commit .env
npx prisma migrate deploy
npx prisma db seed
npm run dev
```

## คำสั่ง
| คำสั่ง | ใช้ทำอะไร |
|---|---|
| `npm run dev` / `build` / `start` | รัน dev / build / รัน production |
| `npm run typecheck` · `npm run lint` | ตรวจ type / lint |
| `npm test` | integration test (ใช้ฐาน dev, ข้อมูลทดสอบขึ้นต้น `ZZ` และถูกลบเอง) |
| `npx tsx scripts/check-deploy.mts` | ตรวจ env และสถานะฐานข้อมูล (ไม่แสดงค่า secret) |
| `ALLOW_DEMO_SEED=1 npx tsx scripts/seed-demo.mts` | สร้างบิลเงินสดย้อนหลัง 30 วันสำหรับสาธิต (เพิ่มข้อมูลถาวร) |

การ deploy ดู [docs/DEPLOY.md](docs/DEPLOY.md) · การตัดสินใจออกแบบดู [docs/DECISIONS.md](docs/DECISIONS.md)
