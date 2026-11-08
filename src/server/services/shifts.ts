// กะ/ลิ้นชักเงินสด
// เงินสดที่ควรมีในลิ้นชัก (expected) = เงินทอนตั้งต้น + ยอดขายเงินสดในช่วงกะ − เงินคืนของบิลเงินสดในช่วงกะ
//  - ช่วงกะ = [เวลาเปิดกะ, เวลาปิดกะ) นับตามเวลาที่ "ขาย/คืน" (ไม่ผูกกับแคชเชียร์ — ลิ้นชักใช้ร่วมกัน)
//  - บิลที่นับ = COMPLETED / PARTIALLY_RETURNED / FULLY_RETURNED (บิลที่ถูกคืนยังนับยอดขาย แล้วหักด้วยเงินคืนตามวันที่คืน)
//  - บิล PromptPay ไม่เข้าลิ้นชัก (แสดงเป็นข้อมูลประกอบ) และเงินคืนบิล QR เป็นการโอนนอกระบบ จึงไม่หักจากลิ้นชัก
//  - difference = เงินที่นับได้ − เงินที่ควรมี (ลบ = ขาด, บวก = เกิน); ถ้าไม่เป็น 0 ต้องมีหมายเหตุ
// ข้อจำกัด: บิลที่กำลังบันทึกอยู่พอดีวินาทีปิดกะอาจตกไปอีกกะ (ระบบไม่บังคับให้ต้องเปิดกะก่อนขาย)
import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { BusinessError } from "@/lib/result";
import { D, round2 } from "@/lib/money";
import type { CurrentUser } from "@/server/auth/guard";
import type { closeShiftSchema, openShiftSchema } from "@/lib/validators/shift";
import type { z } from "zod";

type Num = Prisma.Decimal | number | string | bigint | null;
const dec = (v: Num) => D(v === null ? 0 : typeof v === "bigint" ? Number(v) : v);

export type ShiftFigures = { billCount: number; cashSales: string; cashRefunds: string; qrSales: string; expected: string };

/** คำนวณตัวเลขของกะในช่วง [from, until) (ใช้ทั้งแสดงสดระหว่างกะ และ snapshot ตอนปิดกะ) */
export async function computeFigures(client: Prisma.TransactionClient | typeof db, openingCash: Prisma.Decimal.Value, from: Date, until: Date): Promise<ShiftFigures> {
  const COUNTED = Prisma.sql`s.status IN ('COMPLETED','PARTIALLY_RETURNED','FULLY_RETURNED')`;
  const [sales, refunds] = await Promise.all([
    client.$queryRaw<{ bills: bigint; cash: Num; qr: Num }[]>`
      SELECT COUNT(*) FILTER (WHERE s."paymentMethod"='CASH') AS bills,
             COALESCE(SUM(s.total) FILTER (WHERE s."paymentMethod"='CASH'),0) AS cash,
             COALESCE(SUM(s.total) FILTER (WHERE s."paymentMethod"='PROMPTPAY'),0) AS qr
      FROM "Sale" s WHERE ${COUNTED} AND s."createdAt" >= ${from} AND s."createdAt" < ${until}`,
    client.$queryRaw<{ refunds: Num }[]>`
      SELECT COALESCE(SUM(r."refundTotal"),0) AS refunds
      FROM "SaleReturn" r JOIN "Sale" s ON s.id = r."saleId"
      WHERE s."paymentMethod"='CASH' AND r."createdAt" >= ${from} AND r."createdAt" < ${until}`,
  ]);
  const cash = round2(dec(sales[0].cash)), ref = round2(dec(refunds[0].refunds)), qr = round2(dec(sales[0].qr));
  return {
    billCount: Number(sales[0].bills), cashSales: cash.toFixed(2), cashRefunds: ref.toFixed(2), qrSales: qr.toFixed(2),
    expected: round2(D(openingCash).add(cash).sub(ref)).toFixed(2),
  };
}

export const getOpenShift = () =>
  db.shift.findFirst({ where: { status: "OPEN" }, include: { openedBy: { select: { name: true } } } });

export async function openShift(actor: CurrentUser, input: z.infer<typeof openShiftSchema>) {
  try {
    return await db.$transaction(async (tx) => {
      const shift = await tx.shift.create({ data: { openedById: actor.id, openingCash: input.openingCash } });
      await audit(tx, { userId: actor.id, action: "SHIFT_OPEN", entity: "Shift", entityId: shift.id, after: { shiftNo: shift.shiftNo, openingCash: input.openingCash } });
      return { id: shift.id, shiftNo: shift.shiftNo };
    });
  } catch (e) {
    // unique index บางส่วน shift_only_one_open: มีกะที่เปิดอยู่แล้ว (รวมกรณีกดพร้อมกัน)
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new BusinessError("มีกะที่เปิดอยู่แล้ว กรุณาปิดกะนั้นก่อน");
    throw e;
  }
}

export async function closeShift(actor: CurrentUser, input: z.infer<typeof closeShiftSchema>, now = new Date()) {
  return db.$transaction(async (tx) => {
    // ล็อกแถวกะ กันปิดซ้ำ/ปิดพร้อมกัน
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Shift" WHERE id = ${input.shiftId}::uuid FOR UPDATE`;
    if (locked.length === 0) throw new BusinessError("ไม่พบกะนี้");
    const shift = await tx.shift.findUniqueOrThrow({ where: { id: input.shiftId } });
    if (shift.status !== "OPEN") throw new BusinessError("กะนี้ถูกปิดไปแล้ว");

    const fig = await computeFigures(tx, shift.openingCash, shift.openedAt, now);
    const counted = D(input.countedCash);
    const diff = round2(counted.sub(fig.expected));
    if (!diff.isZero() && !input.note) throw new BusinessError("เงินที่นับได้ไม่ตรงกับยอดที่ควรมี กรุณาระบุหมายเหตุ");

    await tx.shift.update({
      where: { id: shift.id },
      data: {
        status: "CLOSED", closedById: actor.id, closedAt: now, billCount: fig.billCount, cashSales: fig.cashSales, cashRefunds: fig.cashRefunds,
        qrSales: fig.qrSales, expectedCash: fig.expected, countedCash: counted.toFixed(2), difference: diff.toFixed(2), note: input.note,
      },
    });
    await audit(tx, {
      userId: actor.id, action: "SHIFT_CLOSE", entity: "Shift", entityId: shift.id,
      after: { shiftNo: shift.shiftNo, expected: fig.expected, counted: counted.toFixed(2), difference: diff.toFixed(2), note: input.note },
    });
    return { shiftNo: shift.shiftNo, expected: fig.expected, counted: counted.toFixed(2), difference: diff.toFixed(2) };
  });
}

export async function listShifts(limit = 30) {
  return db.shift.findMany({
    orderBy: { openedAt: "desc" }, take: limit,
    include: { openedBy: { select: { name: true } }, closedBy: { select: { name: true } } },
  });
}
