// แยก Sandbox / Production และกันใช้ key ผิดสภาพแวดล้อม (ข้อกำหนด v2.1 หัวข้อ 5)
import type { PaymentEnv } from "@prisma/client";

export type PaymentConfig =
  | { enabled: false; reason: string }
  | { enabled: true; provider: "opn"; environment: PaymentEnv; secretKey: string; webhookSecret: string | null };

export class PaymentConfigError extends Error {}

export function getPaymentConfig(env: NodeJS.ProcessEnv = process.env): PaymentConfig {
  const mode = (env.PAYMENT_ENV ?? "sandbox").toLowerCase();
  if (mode !== "sandbox" && mode !== "production") throw new PaymentConfigError(`PAYMENT_ENV ต้องเป็น sandbox หรือ production (ได้ "${mode}")`);

  if (mode === "production") {
    // production ใช้ได้เฉพาะ deployment production จริงเท่านั้น (Preview/Dev/เครื่องตัวเองต้องเป็น sandbox)
    const isRealProd = env.NODE_ENV === "production" && (!env.VERCEL_ENV || env.VERCEL_ENV === "production");
    if (!isRealProd) throw new PaymentConfigError("PAYMENT_ENV=production ใช้ได้เฉพาะ deployment production เท่านั้น");
    const key = env.PAYMENT_LIVE_SECRET_KEY ?? "";
    if (!key) return { enabled: false, reason: "ยังไม่ได้ตั้ง PAYMENT_LIVE_SECRET_KEY" };
    if (!key.startsWith("skey_") || key.startsWith("skey_test_")) throw new PaymentConfigError("PAYMENT_LIVE_SECRET_KEY ไม่ใช่ live key");
    return { enabled: true, provider: "opn", environment: "PRODUCTION", secretKey: key, webhookSecret: env.PAYMENT_WEBHOOK_SECRET || null };
  }

  const key = env.PAYMENT_SANDBOX_SECRET_KEY ?? "";
  if (!key) return { enabled: false, reason: "ยังไม่ได้ตั้ง PAYMENT_SANDBOX_SECRET_KEY" };
  if (!key.startsWith("skey_test_")) throw new PaymentConfigError("PAYMENT_SANDBOX_SECRET_KEY ต้องเป็น test key (skey_test_...)");
  return { enabled: true, provider: "opn", environment: "SANDBOX", secretKey: key, webhookSecret: env.PAYMENT_WEBHOOK_SECRET || null };
}

/** สำหรับ UI: ไม่โยน error — คืนสถานะที่ผู้ใช้เข้าใจได้ */
export function describePaymentConfig(): { enabled: boolean; environment: PaymentEnv | null; reason?: string } {
  try {
    const c = getPaymentConfig();
    return c.enabled ? { enabled: true, environment: c.environment } : { enabled: false, environment: null, reason: c.reason };
  } catch (e) {
    return { enabled: false, environment: null, reason: e instanceof Error ? e.message : "การตั้งค่าการชำระเงินไม่ถูกต้อง" };
  }
}
