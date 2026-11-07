import type { NotificationType, Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { todayBangkokKey } from "@/lib/date";
import { batchState } from "./inventory";
import { getNearExpiryDays } from "./settings";

type Candidate = { dedupeKey: string; type: NotificationType; title: string; message: string; productId: string; batchId: string | null };

const STOCK_TYPES: NotificationType[] = ["LOW_STOCK", "OUT_OF_STOCK", "NEAR_EXPIRY", "EXPIRED"];

/**
 * คำนวณการแจ้งเตือนสต็อก/หมดอายุจากข้อมูลปัจจุบัน แล้วทำให้ตาราง Notification ตรงกัน (idempotent):
 * - สร้างรายการใหม่ (dedupeKey ซ้ำ = ข้าม) — ไม่มีวันที่ใน key จึงไม่แจ้งซ้ำทุกวัน
 * - ลบรายการที่เงื่อนไขหมดไปแล้ว (เติมสต็อก/ตัดล็อตหมดอายุ) เพื่อให้แจ้งใหม่ได้เมื่อเกิดซ้ำ
 * ไม่มี cron: เรียกหลังเปลี่ยนสต็อก และเมื่อเปิดหน้าที่เกี่ยวข้อง
 */
export async function syncNotifications(): Promise<void> {
  const today = todayBangkokKey();
  const nearDays = await getNearExpiryDays();
  const [products, batches] = await Promise.all([
    db.product.findMany({ where: { isActive: true }, select: { id: true, sku: true, name: true, unit: true, stockQty: true, minStock: true } }),
    db.productBatch.findMany({
      where: { remainingQty: { gt: 0 }, expiryDate: { not: null }, product: { isActive: true } },
      select: { id: true, productId: true, batchNo: true, expiryDate: true, remainingQty: true, product: { select: { name: true, unit: true } } },
    }),
  ]);

  const want: Candidate[] = [];
  for (const p of products) {
    if (p.stockQty <= 0) {
      want.push({ dedupeKey: `OUT_OF_STOCK:${p.id}`, type: "OUT_OF_STOCK", title: "สินค้าหมด", message: `${p.name} (${p.sku}) หมดสต็อก`, productId: p.id, batchId: null });
    } else if (p.stockQty <= p.minStock) {
      want.push({ dedupeKey: `LOW_STOCK:${p.id}`, type: "LOW_STOCK", title: "สินค้าใกล้หมด", message: `${p.name} (${p.sku}) เหลือ ${p.stockQty} ${p.unit} (ขั้นต่ำ ${p.minStock})`, productId: p.id, batchId: null });
    }
  }
  for (const b of batches) {
    const st = batchState(b.expiryDate, today, nearDays);
    const exp = b.expiryDate!.toISOString().slice(0, 10);
    if (st === "EXPIRED") {
      want.push({ dedupeKey: `EXPIRED:${b.id}`, type: "EXPIRED", title: "สินค้าหมดอายุ", message: `${b.product.name} ล็อต ${b.batchNo} หมดอายุ ${exp} เหลือ ${b.remainingQty} ${b.product.unit} — ขายไม่ได้ ควรตัดจำหน่ายด้วยการปรับสต็อก`, productId: b.productId, batchId: b.id });
    } else if (st === "NEAR_EXPIRY") {
      want.push({ dedupeKey: `NEAR_EXPIRY:${b.id}`, type: "NEAR_EXPIRY", title: "ใกล้หมดอายุ", message: `${b.product.name} ล็อต ${b.batchNo} หมดอายุ ${exp} เหลือ ${b.remainingQty} ${b.product.unit}`, productId: b.productId, batchId: b.id });
    }
  }

  const wantKeys = want.map((w) => w.dedupeKey);
  const data: Prisma.NotificationCreateManyInput[] = want;
  await db.$transaction([
    db.notification.createMany({ data, skipDuplicates: true }),
    db.notification.deleteMany({ where: { type: { in: STOCK_TYPES }, dedupeKey: { notIn: wantKeys } } }),
  ]);
}

let lastSync = 0;
/** ใช้ใน layout: ซิงก์อย่างมากทุก 5 นาทีต่อ instance (best-effort) */
export async function syncNotificationsThrottled() {
  if (Date.now() - lastSync < 5 * 60 * 1000) return;
  lastSync = Date.now();
  try {
    await syncNotifications();
  } catch (e) {
    console.error("[notifications sync]", e);
  }
}

export const unreadNotificationCount = () => db.notification.count({ where: { isRead: false } });

export async function listNotifications(onlyUnread: boolean) {
  const rows = await db.notification.findMany({
    where: onlyUnread ? { isRead: false } : undefined,
    orderBy: [{ isRead: "asc" }, { createdAt: "desc" }],
    take: 200,
  });
  return rows.map((n) => ({ id: n.id, type: n.type, title: n.title, message: n.message, productId: n.productId, isRead: n.isRead, createdAt: n.createdAt.toISOString() }));
}

export const markNotificationRead = (id: string) => db.notification.update({ where: { id }, data: { isRead: true } });
export const markAllNotificationsRead = () => db.notification.updateMany({ where: { isRead: false }, data: { isRead: true } });
