// ข้อมูลสาธิตย้อนหลัง: สร้างยอดขาย "เงินสด" ผ่าน checkoutCash ตัวจริง (โปรโมชั่น/FEFO/แต้ม/ใบเสร็จครบ) ไม่ insert ตรง
// ไม่สร้างบิล QR เพราะต้องมีการยืนยันจาก Provider จริง — การสาธิต QR ให้ทำสดกับ Sandbox
// ข้อควรระวัง: เพิ่มข้อมูลถาวรลงฐานที่ DATABASE_URL ชี้อยู่ จึงต้องตั้ง ALLOW_DEMO_SEED=1 ชัดเจนจึงจะรันได้
import { db } from "@/server/db";
import { toBangkokDateKey } from "@/lib/date";
import type { CurrentUser } from "@/server/auth/guard";
import { checkoutCash } from "@/server/services/checkout";
import { returnSale } from "@/server/services/returns";
import { receiveBatch } from "@/server/services/stock";

export type DemoOptions = {
  days?: number; // ย้อนหลังกี่วัน (ไม่รวมวันนี้) ค่าเริ่มต้น 30
  billsPerDay?: [number, number]; // ช่วงจำนวนบิลต่อวัน (วันธรรมดา) ค่าเริ่มต้น [8, 18]
  productIds?: string[]; // จำกัดสินค้า (ใช้ในเทสต์)
  memberIds?: string[]; // จำกัดสมาชิก (ใช้ในเทสต์)
  returns?: number; // จำนวนบิลของ "วันนี้" ที่จะทำคืนสินค้าบางส่วน
  seed?: number; // เมล็ดสุ่ม (ผลซ้ำได้)
  allow?: boolean; // อนุญาตโดยตรง (เทสต์) — ไม่ระบุจะอ่านจาก ALLOW_DEMO_SEED=1
};

export type DemoSummary = { sales: number; skipped: number; returns: number; saleIds: string[]; restocked: number };

function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

export async function generateDemoSales(opts: DemoOptions = {}): Promise<DemoSummary> {
  if (!(opts.allow ?? process.env.ALLOW_DEMO_SEED === "1")) {
    throw new Error("ปฏิเสธ: การสร้างข้อมูลสาธิตเพิ่มข้อมูลถาวรลงฐานข้อมูล ต้องตั้ง ALLOW_DEMO_SEED=1 เพื่อยืนยันก่อน");
  }
  const days = opts.days ?? 30;
  const [lo, hi] = opts.billsPerDay ?? [8, 18];
  const rand = rng(opts.seed ?? 20261107);
  const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];

  const users = await db.user.findMany({ where: { isActive: true, email: { in: ["admin@smartmart.local", "cashier@smartmart.local"] } } });
  const admin = users.find((u) => u.role === "ADMIN");
  if (!admin) throw new Error("ไม่พบผู้ใช้ admin@smartmart.local (รัน seed ก่อน)");
  const actors: CurrentUser[] = users.map((u) => ({ id: u.id, email: u.email, name: u.name, role: u.role }));

  const products = await db.product.findMany({ where: { isActive: true, ...(opts.productIds && { id: { in: opts.productIds } }) }, select: { id: true, price: true, costPrice: true } });
  if (products.length === 0) throw new Error("ไม่มีสินค้าให้สร้างข้อมูลสาธิต");
  const members = await db.member.findMany({ where: { isActive: true, ...(opts.memberIds && { id: { in: opts.memberIds } }) }, select: { id: true } });

  // ความนิยมสินค้า: ลำดับแบบ power-law (บางตัวขายดี บางตัวขายช้า) — ตัวท้าย ๆ ไม่ถูกเลือกเลยในบางวัน ทำให้ BI มี "ขายช้า" ให้เห็น
  const weights = products.map((_, i) => 1 / (1 + i) ** 0.8).sort(() => rand() - 0.5);
  const totalW = weights.reduce((a, b) => a + b, 0);
  const pickProduct = () => { let r = rand() * totalW; for (let i = 0; i < products.length; i++) { r -= weights[i]; if (r <= 0) return products[i]; } return products[0]; };
  const slowTail = new Set(products.slice(-Math.max(1, Math.floor(products.length / 8))).map((p) => p.id)); // ไม่มียอดขายช่วง 14 วันล่าสุด

  // เติมสต็อกให้พอขายตลอดช่วงสาธิต (เป็นล็อตรับเข้าย้อนหลังที่ต้นช่วง) — ไม่ให้สต็อกเดิมของร้านถูกใช้หมด
  const start = new Date(`${toBangkokDateKey(new Date())}T00:00:00.000Z`);
  start.setUTCDate(start.getUTCDate() - days);
  let restocked = 0;
  const perProduct = Math.ceil(((days + 1) * ((lo + hi) / 2) * 2.2) / products.length) + 40;
  for (const p of products) {
    await db.$transaction((tx) =>
      receiveBatch(tx, admin.id, { productId: p.id, qty: perProduct, costPrice: p.costPrice, expiryDate: null, type: "RESTOCK", note: "ข้อมูลสาธิต: เติมสต็อกย้อนหลัง", receivedAt: new Date(`${start.toISOString().slice(0, 10)}T01:00:00+07:00`) }),
    );
    restocked += perProduct;
  }

  const created: { id: string; createdAt: Date; todayIdx: number }[] = [];
  let skipped = 0;
  const now = new Date();
  const todayKey = toBangkokDateKey(now);

  for (let off = -days; off <= 0; off++) {
    const d = new Date(`${todayKey}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + off);
    const key = d.toISOString().slice(0, 10);
    const dow = d.getUTCDay(); // 0=อา, 6=ส
    const growth = 1 + ((off + days) / Math.max(days, 1)) * 0.35; // แนวโน้มขาขึ้นเล็กน้อยตลอดช่วง
    const factor = (dow === 0 || dow === 6 ? 1.4 : 1) * growth;
    const n = Math.max(1, Math.round((lo + rand() * (hi - lo)) * factor));
    const times = Array.from({ length: n }, () => {
      const hour = 8 + Math.floor((rand() * 0.55 + rand() * 0.45) * 14); // 08:00–21:59 เน้นช่วงบ่าย-เย็น
      return new Date(`${key}T${String(hour).padStart(2, "0")}:${String(Math.floor(rand() * 60)).padStart(2, "0")}:${String(Math.floor(rand() * 60)).padStart(2, "0")}+07:00`);
    }).filter((t) => t <= now).sort((a, b) => a.getTime() - b.getTime());

    for (const at of times) {
      const lines = new Map<string, number>();
      const count = 1 + Math.floor(rand() * 4);
      for (let i = 0; i < count; i++) {
        const p = pickProduct();
        if (off > -14 && slowTail.has(p.id)) continue;
        lines.set(p.id, (lines.get(p.id) ?? 0) + 1 + Math.floor(rand() * 3));
      }
      if (lines.size === 0) continue;
      const memberId = members.length > 0 && rand() < 0.3 ? pick(members).id : null;
      try {
        const r = await checkoutCash(pick(actors), {
          idempotencyKey: crypto.randomUUID(), items: [...lines].map(([productId, quantity]) => ({ productId, quantity })),
          amountPaid: "999999", memberId, at,
        });
        created.push({ id: r.saleId, createdAt: at, todayIdx: off });
      } catch (e) {
        skipped++;
        if (!(e instanceof Error) || !/สต็อกไม่พอ/.test(e.message)) throw e;
      }
    }
  }

  // ปรับ "เวลาที่เกิดจริง" ของข้อมูลที่ผูกกับบิล (ประวัติสต็อก/แต้ม) ให้ตรงกับเวลาขายย้อนหลัง และแก้เงินรับให้สมเหตุสมผล (ปัดขึ้นเป็นหลัก 20)
  for (const s of created) {
    await db.$transaction([
      db.$executeRaw`UPDATE "StockMovement" SET "createdAt" = ${s.createdAt} WHERE "saleId" = ${s.id}::uuid AND type = 'SALE'`,
      db.$executeRaw`UPDATE "PointTransaction" SET "createdAt" = ${s.createdAt} WHERE "saleId" = ${s.id}::uuid AND type = 'EARN'`,
      db.$executeRaw`UPDATE "Sale" SET "amountPaid" = CEIL(total / 20) * 20, "changeAmount" = CEIL(total / 20) * 20 - total WHERE id = ${s.id}::uuid AND "paymentMethod" = 'CASH'`,
    ]);
  }

  // คืนสินค้าบางส่วนของบิล "วันนี้" (เลขที่ใบคืนและวันที่คืนจึงเป็นวันนี้จริง)
  let returns = 0;
  const todays = created.filter((c) => c.todayIdx === 0);
  for (const s of todays.slice(0, opts.returns ?? 3)) {
    const items = await db.saleItem.findMany({ where: { saleId: s.id } });
    const it = items[0];
    if (!it) continue;
    await returnSale({ id: admin.id, email: admin.email, name: admin.name, role: admin.role }, {
      saleId: s.id, items: [{ saleItemId: it.id, quantity: 1, restock: true }], reason: "ข้อมูลสาธิต: ลูกค้าเปลี่ยนใจ", refundNote: null, idempotencyKey: crypto.randomUUID(),
    });
    returns++;
  }
  return { sales: created.length, skipped, returns, saleIds: created.map((c) => c.id), restocked };
}
