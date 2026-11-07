import { db } from "@/server/db";

export async function getSettingNumber(key: string, fallback: number): Promise<number> {
  const s = await db.systemSetting.findUnique({ where: { key }, select: { value: true } });
  const n = s ? Number(s.value) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export const getNearExpiryDays = () => getSettingNumber("near_expiry_days", 30);

/* ───────────── หน้าตั้งค่า (ADMIN) ───────────── */
import { audit } from "@/server/audit";
import type { CurrentUser } from "@/server/auth/guard";
import type { SettingsInput } from "@/lib/validators/settings";

export const SETTING_DEFAULTS: SettingsInput = {
  store_name: "SmartMart", store_address: "", store_phone: "", receipt_footer: "ขอบคุณที่ใช้บริการ",
  points_per_baht: 25, near_expiry_days: 30, qr_expire_minutes: 10,
};

export async function getSettings(): Promise<SettingsInput> {
  const rows = await db.systemSetting.findMany({ where: { key: { in: Object.keys(SETTING_DEFAULTS) } } });
  const m = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const d = SETTING_DEFAULTS;
  const num = (k: keyof SettingsInput) => (Number.isFinite(Number(m[k])) && m[k] !== undefined ? Number(m[k]) : (d[k] as number));
  return {
    store_name: m.store_name ?? d.store_name, store_address: m.store_address ?? d.store_address, store_phone: m.store_phone ?? d.store_phone, receipt_footer: m.receipt_footer ?? d.receipt_footer,
    points_per_baht: num("points_per_baht"), near_expiry_days: num("near_expiry_days"), qr_expire_minutes: num("qr_expire_minutes"),
  };
}

export async function updateSettings(actor: CurrentUser, input: SettingsInput) {
  const before = await getSettings();
  const changed = (Object.keys(input) as (keyof SettingsInput)[]).filter((k) => String(input[k]) !== String(before[k]));
  if (changed.length === 0) return { changed: 0 };
  await db.$transaction(async (tx) => {
    for (const k of changed) await tx.systemSetting.upsert({ where: { key: k }, update: { value: String(input[k]) }, create: { key: k, value: String(input[k]) } });
    await audit(tx, {
      userId: actor.id, action: "SETTINGS_UPDATE", entity: "SystemSetting",
      before: Object.fromEntries(changed.map((k) => [k, before[k]])), after: Object.fromEntries(changed.map((k) => [k, input[k]])),
    });
  });
  return { changed: changed.length };
}
