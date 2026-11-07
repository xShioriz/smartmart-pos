# คู่มือ Deploy (Production บน Vercel + Neon)

หลักการ: ฐาน production แยกจากฐาน dev, secret ใส่เองใน Vercel/terminal ของตัวเองเท่านั้น (ห้ามส่งในแชต ห้าม commit)

## 1) สร้างฐาน production บน Neon
1. Neon Console → Project เดิม → **Branches → Create branch** ชื่อ `production` (เลือก parent ให้ **ว่าง/ไม่คัดลอกข้อมูล dev** — ถ้าไม่มีตัวเลือก ให้สร้าง Project ใหม่ชื่อ `smartmart-prod`)
2. เปิด **Connection details** ของ branch นั้น คัดลอก 2 ค่า:
   - **Pooled** (มี `-pooler` ในชื่อ host) → `DATABASE_URL`
   - **Direct** (ปิด Connection pooling) → `DIRECT_URL`

## 2) สร้างตาราง + ข้อมูลตั้งต้นบนฐาน production (จากเครื่องคุณ)
เปิด PowerShell ในโฟลเดอร์ `smartmart-pos` แล้วตั้งค่า **เฉพาะ terminal นี้** (ตัวแปรใน terminal ชนะ `.env`):
```powershell
$env:DATABASE_URL = "วาง pooled URL ของ production"
$env:DIRECT_URL = "วาง direct URL ของ production"
$env:SEED_ADMIN_PASSWORD = "ตั้งรหัสผ่าน admin ที่เดายาก"
$env:SEED_CASHIER_PASSWORD = "ตั้งรหัสผ่าน cashier"
npx prisma migrate deploy
npx prisma db seed
npx tsx scripts/check-deploy.mts
```
ผลที่ต้องได้: migration ครบ 3 รายการ, host ไม่ใช่ host ของ dev, "ผ่านทุกข้อ" แล้วปิด terminal นั้นทิ้ง

> ห้ามใช้ `prisma migrate dev` กับ production

## 3) ตั้งค่า Environment Variables บน Vercel
Project → Settings → Environment Variables → เลือก **Production** (Preview ให้ชี้ฐาน dev):

| ชื่อ | ค่า |
|---|---|
| `DATABASE_URL` | pooled URL ของ production |
| `DIRECT_URL` | direct URL ของ production |
| `SESSION_SECRET` | สุ่มใหม่ ≥ 32 ตัว (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`) — อย่าใช้ซ้ำกับ dev |
| `PAYMENT_ENV` | `sandbox` |
| `PAYMENT_SANDBOX_SECRET_KEY` | `skey_test_...` จาก Omise/Opn dashboard (โหมด test) |
| `PAYMENT_WEBHOOK_SECRET` | (ไม่บังคับ) |

แล้ว **Redeploy** (Deployments → ⋯ → Redeploy) เพราะ env มีผลกับ build ใหม่เท่านั้น
ห้ามตั้ง `PAYMENT_ENV=production` โดยไม่มี live key และ merchant account

## 4) Webhook (Sandbox)
Omise dashboard → โหมด **Test** → Webhooks → ตั้ง endpoint เป็น `https://<โดเมน production>/api/webhooks/payment`
(เว็บยืนยันการจ่ายจากการเรียก API ของ Provider ซ้ำอยู่แล้ว webhook เป็นแค่สัญญาณ ถ้าไม่ถึงจะมี reconcile สำรอง)

## 5) ตรวจหลัง deploy (ทำทีละข้อ)
- [ ] เปิดหน้าเว็บ → redirect ไป `/login`; login admin ได้
- [ ] ขายเงินสด 1 บิล → เปิดใบเสร็จได้ สต็อกลดถูกต้อง
- [ ] ขาย PromptPay QR (Sandbox) → ในหน้า Omise test dashboard กด Mark as paid → บิลเปลี่ยนเป็นชำระแล้ว
- [ ] คืนสินค้า 1 รายการ (admin)
- [ ] `/dashboard` `/reports` `/settings` เปิดได้ (admin) และ cashier เข้าไม่ได้
- [ ] เปลี่ยนรหัสผ่านตั้งต้นหากเคยใช้ค่าทั่วไป

## 6) ข้อมูลสาธิต (ไม่บังคับ)
ถ้าต้องการกราฟสวยตอนนำเสนอ รันได้เฉพาะเมื่อ **ยืนยันฐานปลายทางแล้ว** (สคริปต์พิมพ์ host ให้ดู) — ใน terminal ที่ตั้ง `$env:DATABASE_URL` ของ production:
```powershell
$env:ALLOW_DEMO_SEED = "1"
npx tsx scripts/seed-demo.mts --days 30
```
เพิ่มข้อมูลถาวรและปรับสต็อกสินค้าทุกตัว ย้อนกลับไม่ง่าย — ถ้าไม่ชอบให้สร้าง Neon branch ใหม่แล้ว migrate/seed ใหม่

## 7) แผนสำรองวันนำเสนอ
1. ตัวหลัก: เว็บ production บน Vercel
2. สำรอง: รันในเครื่อง `npm run build && npm start` ชี้ฐาน dev (เปิดไว้ก่อนเข้าห้อง)
3. QR สาธิตต้องใช้อินเทอร์เน็ต + Omise test dashboard เปิดไว้ในอีกแท็บ; ถ้าเน็ตล่ม ให้สาธิตเงินสดและชี้ผลทดสอบอัตโนมัติ (140 เคส) แทน
4. เตรียมภาพหน้าจอทุกหน้าสำรองไว้
