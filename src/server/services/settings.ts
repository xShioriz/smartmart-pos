import { db } from "@/server/db";

export async function getSettingNumber(key: string, fallback: number): Promise<number> {
  const s = await db.systemSetting.findUnique({ where: { key }, select: { value: true } });
  const n = s ? Number(s.value) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export const getNearExpiryDays = () => getSettingNumber("near_expiry_days", 30);
