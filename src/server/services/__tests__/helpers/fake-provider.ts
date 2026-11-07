// FakeProvider สำหรับ "ไฟล์ทดสอบเท่านั้น" — ไม่ใช่การจำลองการจ่ายเงินในแอป (registry สลับได้เฉพาะ NODE_ENV=test)
import { randomBytes } from "node:crypto";
import { ProviderError, type CreatePromptPayInput, type PaymentProvider, type ProviderCharge } from "@/server/payments/types";

export class FakeProvider implements PaymentProvider {
  name = "fake";
  livemode = false;
  charges = new Map<string, ProviderCharge>();
  byKey = new Map<string, string>();
  createCalls = 0;
  failCreate = false;

  async createPromptPayCharge(i: CreatePromptPayInput) {
    this.createCalls++;
    if (this.failCreate) throw new ProviderError("boom");
    const existing = this.byKey.get(i.idempotencyKey);
    if (existing) return { ...this.charges.get(existing)! };
    const id = `chrg_test_${randomBytes(8).toString("hex")}`;
    const c: ProviderCharge = { id, status: "pending", paid: false, amountSatang: i.amountSatang, currency: "THB", livemode: false, expiresAt: i.expiresAt, qrImageUrl: `https://example.test/qr/${id}.png`, failureCode: null, metadata: { ...i.metadata } };
    this.charges.set(id, c);
    this.byKey.set(i.idempotencyKey, id);
    return { ...c };
  }
  async retrieveCharge(id: string) {
    const c = this.charges.get(id);
    if (!c) throw new ProviderError("not found");
    return { ...c };
  }
  verifyWebhookSignature(_raw: string, headers: Headers) {
    return headers.get("x-bad") ? { checked: true, valid: false, reason: "bad" } : { checked: true, valid: true };
  }
  pay(id: string) { Object.assign(this.charges.get(id)!, { status: "successful", paid: true }); }
  fail(id: string) { Object.assign(this.charges.get(id)!, { status: "failed", paid: false, failureCode: "insufficient_fund" }); }
  expire(id: string) { Object.assign(this.charges.get(id)!, { status: "expired", paid: false }); }
}
