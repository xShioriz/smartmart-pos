# SmartMart POS — กฎการทำงาน

แผนหลักอยู่ที่ `docs/` (Plan v1 → v2 → v2.1; ฉบับล่าสุดที่ใช้คือ v2.1 ซึ่งแทนที่ส่วนที่ขัดแย้ง)
Stack: Next.js (App Router) · TypeScript · Tailwind · shadcn/ui · Prisma 6 · PostgreSQL (Neon) · Zod · jose + bcryptjs · Recharts

## กฎเหล็ก
1. ทำทีละ slice เล็ก ทดสอบก่อนไปต่อ; อ่านไฟล์ก่อนแก้; ห้ามเขียนทับของที่ทำงานแล้วโดยไม่บอกเหตุผล
2. Business logic อยู่ใน `src/server/services/*` เท่านั้น; Server Action ต้อง Zod validate → `requireRole()` → เรียก service
3. **ห้ามเชื่อราคา/ยอดรวม/ส่วนลด/สต็อกจาก client** ทุกอย่างคำนวณจาก DB ฝั่ง server
4. เงิน = `Prisma.Decimal` (ใช้ `src/lib/money.ts`) ห้ามคำนวณเงินด้วย `number`
5. วัน/เวลา = `src/lib/date.ts` (Asia/Bangkok) เท่านั้น
6. `Product.stockQty`, `ProductBatch.remainingQty`, `Member.points` แก้ผ่าน stock/loyalty service เท่านั้น
7. สถานะ Payment เป็น PAID ได้ทางเดียว: ฟังก์ชัน `confirmPayment()` หลัง Provider API ยืนยันเอง — ห้ามมีปุ่ม/endpoint ตั้ง PAID ตรง ๆ และห้ามจำลองการจ่ายโดยไม่ระบุว่า Sandbox
8. ห้ามแตะ/พิมพ์ค่าใน `.env`; Secrets อยู่ใน env vars เท่านั้น
9. ห้ามเพิ่ม dependency โดยไม่ถามก่อน; ห้ามทำฟีเจอร์ที่อยู่นอกขอบเขตแผน
10. ห้ามแก้ migration ที่ apply แล้ว; หลังแก้ schema: `npx prisma validate && npx prisma generate && npx tsc --noEmit`
11. ห้ามกล่าวว่า "ทำงานได้" หากไม่ได้ทดสอบจริง — ระบุสิ่งที่ยังไม่ได้ทดสอบ
12. อัปเดต `docs/DECISIONS.md` เมื่อมีการตัดสินใจสำคัญ

## รายงานท้ายงานทุกครั้ง
ทำอะไรเสร็จ · ไฟล์ที่แก้ · คำสั่งที่ใช้ · ทดสอบอะไร (และอะไรยังไม่ได้ทดสอบ) · ข้อผิดพลาด/วิธีแก้ · ปัญหาที่เหลือ · ขั้นตอนถัดไป

## คำสั่ง
- `npm run dev` · `npm run build` · `npm run lint` · `npm run typecheck` · `npm test`
- DB: `npx prisma migrate dev` · `npx prisma db seed`
