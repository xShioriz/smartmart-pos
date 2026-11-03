// Seed พื้นฐาน (รันซ้ำได้): ผู้ใช้, หมวด, สินค้า+batch, สมาชิก, โปรโมชั่น, settings
// ยอดขายย้อนหลังสร้างด้วย seed-demo (Day 8) ผ่าน service จริง ไม่ insert ตรง
import { PrismaClient, Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";

const db = new PrismaClient();
const DAY = 24 * 60 * 60 * 1000;

function expiryIn(days: number | null): Date | null {
  if (days === null) return null;
  const d = new Date(Date.now() + days * DAY + 7 * 60 * 60 * 1000);
  return new Date(d.toISOString().slice(0, 10) + "T00:00:00.000Z"); // @db.Date
}

// [sku, barcode, name, category, cost, price, unit, minStock, [qty, expiryDays|null][]]
type Row = [string, string, string, string, number, number, string, number, [number, number | null][]];

const CATEGORIES = ["เครื่องดื่ม", "ขนมขบเคี้ยว", "อาหารสำเร็จรูป", "ของใช้ในบ้าน", "นม/ไอศกรีม", "เครื่องเขียน", "สุขภาพ/ความงาม"];

const PRODUCTS: Row[] = [
  ["DR001", "8850000000011", "น้ำดื่ม 600 มล.", "เครื่องดื่ม", 4, 7, "ขวด", 24, [[60, 300], [48, 420]]],
  ["DR002", "8850000000028", "โค้ก 325 มล.", "เครื่องดื่ม", 9, 15, "กระป๋อง", 24, [[36, 150], [36, 220]]],
  ["DR003", "8850000000035", "ชาเขียวพร้อมดื่ม", "เครื่องดื่ม", 10, 18, "ขวด", 12, [[24, 120]]],
  ["DR004", "8850000000042", "กาแฟกระป๋อง", "เครื่องดื่ม", 11, 20, "กระป๋อง", 12, [[30, 180]]],
  ["DR005", "8850000000059", "น้ำส้ม 100%", "เครื่องดื่ม", 14, 25, "กล่อง", 10, [[12, 25], [18, 90]]],
  ["DR006", "8850000000066", "เครื่องดื่มเกลือแร่", "เครื่องดื่ม", 12, 20, "ขวด", 10, [[20, 240]]],
  ["DR007", "8850000000073", "น้ำอัดลมส้ม", "เครื่องดื่ม", 9, 15, "กระป๋อง", 12, [[3, 200]]],
  ["SN001", "8850000000110", "มันฝรั่งทอดกรอบ", "ขนมขบเคี้ยว", 15, 25, "ซอง", 12, [[30, 200]]],
  ["SN002", "8850000000127", "ข้าวโพดอบกรอบ", "ขนมขบเคี้ยว", 8, 14, "ซอง", 12, [[40, 170]]],
  ["SN003", "8850000000134", "เวเฟอร์ช็อกโกแลต", "ขนมขบเคี้ยว", 6, 10, "ชิ้น", 20, [[50, 300]]],
  ["SN004", "8850000000141", "ช็อกโกแลตแท่ง", "ขนมขบเคี้ยว", 14, 25, "แท่ง", 10, [[24, 260]]],
  ["SN005", "8850000000158", "สาหร่ายทอดกรอบ", "ขนมขบเคี้ยว", 12, 20, "ซอง", 10, [[18, 120]]],
  ["SN006", "8850000000165", "ถั่วลิสงอบ", "ขนมขบเคี้ยว", 9, 15, "ซอง", 10, [[22, 150]]],
  ["SN007", "8850000000172", "ลูกอมมินต์", "ขนมขบเคี้ยว", 7, 12, "หลอด", 15, [[40, null]]],
  ["FD001", "8850000000219", "บะหมี่กึ่งสำเร็จรูปรสหมูสับ", "อาหารสำเร็จรูป", 5, 8, "ซอง", 30, [[100, 200]]],
  ["FD002", "8850000000226", "บะหมี่ถ้วยต้มยำ", "อาหารสำเร็จรูป", 12, 18, "ถ้วย", 20, [[48, 180]]],
  ["FD003", "8850000000233", "ข้าวกล่องแช่แข็ง", "อาหารสำเร็จรูป", 28, 45, "กล่อง", 8, [[6, 4], [10, 20]]],
  ["FD004", "8850000000240", "แซนด์วิชแฮมชีส", "อาหารสำเร็จรูป", 18, 30, "ชิ้น", 6, [[8, 3]]],
  ["FD005", "8850000000257", "ไส้กรอกพร้อมทาน", "อาหารสำเร็จรูป", 6, 10, "ชิ้น", 15, [[30, 60]]],
  ["FD006", "8850000000264", "ปลากระป๋อง", "อาหารสำเร็จรูป", 16, 25, "กระป๋อง", 12, [[36, 500]]],
  ["FD007", "8850000000271", "ข้าวสารหอมมะลิ 1 กก.", "อาหารสำเร็จรูป", 35, 48, "ถุง", 10, [[25, null]]],
  ["HH001", "8850000000318", "ผงซักฟอก 800 ก.", "ของใช้ในบ้าน", 45, 69, "ถุง", 6, [[14, null]]],
  ["HH002", "8850000000325", "น้ำยาล้างจาน 500 มล.", "ของใช้ในบ้าน", 22, 35, "ขวด", 8, [[20, null]]],
  ["HH003", "8850000000332", "กระดาษทิชชู่ 6 ม้วน", "ของใช้ในบ้าน", 38, 59, "แพ็ก", 8, [[16, null]]],
  ["HH004", "8850000000349", "ถุงขยะ 18x20", "ของใช้ในบ้าน", 18, 29, "แพ็ก", 8, [[18, null]]],
  ["HH005", "8850000000356", "สบู่ก้อน", "ของใช้ในบ้าน", 10, 17, "ก้อน", 15, [[40, null]]],
  ["HH006", "8850000000363", "ไฟแช็ก", "ของใช้ในบ้าน", 8, 15, "อัน", 10, [[2, null]]],
  ["DA001", "8850000000417", "นมสดพาสเจอร์ไรซ์ 200 มล.", "นม/ไอศกรีม", 9, 14, "กล่อง", 20, [[24, 6], [36, 12]]],
  ["DA002", "8850000000424", "นมยูเอชที จืด 180 มล.", "นม/ไอศกรีม", 8, 12, "กล่อง", 24, [[72, 120]]],
  ["DA003", "8850000000431", "โยเกิร์ตถ้วย", "นม/ไอศกรีม", 10, 16, "ถ้วย", 12, [[18, 10]]],
  ["DA004", "8850000000448", "ไอศกรีมแท่งวานิลลา", "นม/ไอศกรีม", 12, 20, "แท่ง", 10, [[24, 90]]],
  ["DA005", "8850000000455", "ไอศกรีมถ้วยช็อกโกแลต", "นม/ไอศกรีม", 15, 25, "ถ้วย", 10, [[16, 90]]],
  ["DA006", "8850000000462", "นมเปรี้ยว", "นม/ไอศกรีม", 5, 8, "ขวด", 20, [[48, -2], [12, 14]]], // มีล็อตหมดอายุแล้ว ไว้สาธิต
  ["ST001", "8850000000510", "ปากกาลูกลื่น", "เครื่องเขียน", 4, 7, "ด้าม", 30, [[80, null]]],
  ["ST002", "8850000000527", "สมุดโน้ต A5", "เครื่องเขียน", 18, 30, "เล่ม", 10, [[24, null]]],
  ["ST003", "8850000000534", "ดินสอ 2B", "เครื่องเขียน", 3, 6, "แท่ง", 30, [[60, null]]],
  ["ST004", "8850000000541", "กาวแท่ง", "เครื่องเขียน", 12, 20, "แท่ง", 8, [[15, null]]],
  ["ST005", "8850000000558", "เทปใส", "เครื่องเขียน", 7, 12, "ม้วน", 10, [[20, null]]],
  ["HB001", "8850000000619", "แชมพู 170 มล.", "สุขภาพ/ความงาม", 35, 55, "ขวด", 6, [[14, 500]]],
  ["HB002", "8850000000626", "ยาสีฟัน 160 ก.", "สุขภาพ/ความงาม", 30, 49, "หลอด", 8, [[20, 600]]],
  ["HB003", "8850000000633", "แปรงสีฟัน", "สุขภาพ/ความงาม", 15, 25, "อัน", 10, [[25, null]]],
  ["HB004", "8850000000640", "ผ้าอนามัย", "สุขภาพ/ความงาม", 20, 32, "ห่อ", 8, [[16, 700]]],
  ["HB005", "8850000000657", "พลาสเตอร์ปิดแผล", "สุขภาพ/ความงาม", 15, 25, "กล่อง", 6, [[12, 700]]],
  ["HB006", "8850000000664", "แอลกอฮอล์ล้างมือ 100 มล.", "สุขภาพ/ความงาม", 25, 39, "ขวด", 6, [[10, 400]]],
];

async function main() {
  const adminPw = process.env.SEED_ADMIN_PASSWORD;
  const cashierPw = process.env.SEED_CASHIER_PASSWORD;
  if (!adminPw || !cashierPw) throw new Error("ตั้ง SEED_ADMIN_PASSWORD และ SEED_CASHIER_PASSWORD ใน .env ก่อน");

  // ผู้ใช้ (ไม่เขียนทับรหัสผ่านถ้ามีอยู่แล้ว)
  const admin = await db.user.upsert({
    where: { email: "admin@smartmart.local" },
    update: {},
    create: { email: "admin@smartmart.local", name: "ผู้ดูแลระบบ", role: "ADMIN", passwordHash: await bcrypt.hash(adminPw, 10) },
  });
  await db.user.upsert({
    where: { email: "cashier@smartmart.local" },
    update: {},
    create: { email: "cashier@smartmart.local", name: "แคชเชียร์ 1", role: "CASHIER", passwordHash: await bcrypt.hash(cashierPw, 10) },
  });

  // หมวด
  const cat: Record<string, string> = {};
  for (const name of CATEGORIES) {
    cat[name] = (await db.category.upsert({ where: { name }, update: {}, create: { name } })).id;
  }

  // สินค้า + batch (+ movement INITIAL เมื่อสร้าง batch ใหม่)
  for (const [sku, barcode, name, category, cost, price, unit, minStock, batches] of PRODUCTS) {
    const product = await db.product.upsert({
      where: { sku },
      update: {},
      create: { sku, barcode, name, categoryId: cat[category], costPrice: cost, price, unit, minStock },
    });
    let n = 0;
    for (const [qty, days] of batches) {
      n++;
      const batchNo = `SEED-${String(n).padStart(2, "0")}`;
      const exists = await db.productBatch.findUnique({ where: { productId_batchNo: { productId: product.id, batchNo } } });
      if (exists) continue;
      await db.$transaction(async (tx) => {
        const batch = await tx.productBatch.create({
          data: { productId: product.id, batchNo, expiryDate: expiryIn(days), costPrice: cost, initialQty: qty, remainingQty: qty },
        });
        const agg = await tx.productBatch.aggregate({ where: { productId: product.id }, _sum: { remainingQty: true } });
        const total = agg._sum.remainingQty ?? 0;
        await tx.product.update({ where: { id: product.id }, data: { stockQty: total } });
        await tx.stockMovement.create({
          data: { productId: product.id, batchId: batch.id, type: "INITIAL", quantityChange: qty, balanceAfter: total, note: "ยอดยกมา (seed)", createdById: admin.id },
        });
      });
    }
  }

  // สมาชิก
  const members: [string, string, string][] = [
    ["M0001", "สมชาย ใจดี", "0810000001"], ["M0002", "สมหญิง รักสวย", "0810000002"], ["M0003", "วิชัย มั่งมี", "0810000003"],
    ["M0004", "นภา สดใส", "0810000004"], ["M0005", "ประเสริฐ ศรีสุข", "0810000005"], ["M0006", "กานดา ทองดี", "0810000006"],
    ["M0007", "อนุชา พงษ์ไทย", "0810000007"], ["M0008", "ลัดดา วงศ์ใหญ่", "0810000008"],
  ];
  for (const [code, name, phone] of members) {
    await db.member.upsert({ where: { code }, update: {}, create: { code, name, phone } });
  }

  // โปรโมชั่น (ตัวอย่างหลายสถานะ: ใช้งาน / หมดอายุ / ยังไม่เริ่ม)
  const hasPromo = await db.promotion.count();
  if (hasPromo === 0) {
    const p = (sku: string) => db.product.findUniqueOrThrow({ where: { sku } });
    const now = Date.now();
    await db.promotion.createMany({
      data: [
        { name: "น้ำส้ม 100% ลด 10%", scope: "PRODUCT", discountType: "PERCENT", value: new Prisma.Decimal(10), productId: (await p("DR005")).id, startsAt: new Date(now - 7 * DAY), endsAt: new Date(now + 30 * DAY) },
        { name: "ขนมขบเคี้ยว ลด 2 บาท", scope: "CATEGORY", discountType: "FIXED", value: new Prisma.Decimal(2), categoryId: cat["ขนมขบเคี้ยว"], startsAt: new Date(now - 7 * DAY), endsAt: new Date(now + 30 * DAY) },
        { name: "ซื้อครบ 300 ลด 20 บาท", scope: "BILL", discountType: "FIXED", value: new Prisma.Decimal(20), minPurchase: new Prisma.Decimal(300), startsAt: new Date(now - 7 * DAY), endsAt: new Date(now + 30 * DAY) },
        { name: "โปรเก่า (หมดอายุแล้ว)", scope: "BILL", discountType: "PERCENT", value: new Prisma.Decimal(5), minPurchase: new Prisma.Decimal(100), startsAt: new Date(now - 60 * DAY), endsAt: new Date(now - 30 * DAY) },
        { name: "โปรล่วงหน้า (ยังไม่เริ่ม)", scope: "BILL", discountType: "PERCENT", value: new Prisma.Decimal(10), minPurchase: new Prisma.Decimal(500), startsAt: new Date(now + 15 * DAY), endsAt: new Date(now + 45 * DAY) },
      ],
    });
  }

  // settings
  const settings: Record<string, string> = {
    store_name: "SmartMart (ร้านตัวอย่าง)",
    store_address: "123 ถนนตัวอย่าง กรุงเทพฯ 10000",
    store_phone: "02-000-0000",
    receipt_footer: "ขอบคุณที่ใช้บริการ",
    points_per_baht: "25",
    near_expiry_days: "30",
  };
  for (const [key, value] of Object.entries(settings)) {
    await db.systemSetting.upsert({ where: { key }, update: {}, create: { key, value } });
  }

  console.log("Seed เสร็จสิ้น");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
