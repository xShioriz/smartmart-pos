import { getPaymentConfig } from "./config";
import { createOpnProvider } from "./opn";
import type { PaymentProvider } from "./types";
import { BusinessError } from "@/lib/result";

let override: PaymentProvider | null = null;

/** ใช้ได้เฉพาะ NODE_ENV=test (vitest) เพื่อสลับเป็น FakeProvider — ห้ามเรียกจากโค้ดแอป */
export function _setProviderForTests(p: PaymentProvider | null) {
  if (process.env.NODE_ENV !== "test") throw new Error("_setProviderForTests ใช้ได้เฉพาะตอนทดสอบ");
  override = p;
}

export function getProvider(): PaymentProvider {
  if (override) return override;
  const cfg = getPaymentConfig();
  if (!cfg.enabled) throw new BusinessError(`ยังไม่เปิดใช้การชำระเงินด้วย QR: ${cfg.reason}`);
  return createOpnProvider({ secretKey: cfg.secretKey, livemode: cfg.environment === "PRODUCTION", webhookSecret: cfg.webhookSecret });
}
