// สัญญากลางของ Payment Provider — เปลี่ยน Provider ได้โดยเขียน adapter ใหม่ไฟล์เดียว
export type ProviderChargeStatus = "pending" | "successful" | "failed" | "expired" | "reversed";

export type ProviderCharge = {
  id: string;
  status: ProviderChargeStatus;
  paid: boolean;
  amountSatang: number;
  currency: string;
  livemode: boolean;
  expiresAt: Date | null;
  qrImageUrl: string | null;
  failureCode: string | null;
  metadata: Record<string, string>;
};

export type CreatePromptPayInput = {
  amountSatang: number;
  expiresAt: Date;
  metadata: Record<string, string>;
  description: string;
  idempotencyKey: string;
};

export interface PaymentProvider {
  readonly name: string;
  readonly livemode: boolean; // true = production
  createPromptPayCharge(input: CreatePromptPayInput): Promise<ProviderCharge>;
  retrieveCharge(chargeId: string): Promise<ProviderCharge>;
  /** ตรวจลายเซ็น webhook; webhookSecret ไม่ได้ตั้ง = ตรวจไม่ได้ (checked=false) ต้องพึ่งการดึง Charge ซ้ำจาก API */
  verifyWebhookSignature(rawBody: string, headers: Headers): { checked: boolean; valid: boolean; reason?: string };
}

/** ข้อผิดพลาดจากการเรียก Provider (ข้อความภายใน — ไม่แสดงให้ผู้ใช้เห็นตรง ๆ) */
export class ProviderError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
  }
}
