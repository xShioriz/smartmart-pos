// Adapter: Opn Payments (Omise) — PromptPay เท่านั้น
// อ้างอิงเอกสาร: POST /charges (source[type]=promptpay, expires_at), GET /charges/:id,
// webhook เซ็น HMAC-SHA256 (headers Omise-Signature / Omise-Signature-Timestamp; secret เป็น base64)
import { createHmac, timingSafeEqual } from "node:crypto";
import { ProviderError, type CreatePromptPayInput, type PaymentProvider, type ProviderCharge, type ProviderChargeStatus } from "./types";

const API = "https://api.omise.co";
const STATUSES: ProviderChargeStatus[] = ["pending", "successful", "failed", "expired", "reversed"];

type OmiseCharge = {
  object?: string; id?: string; status?: string; paid?: boolean; amount?: number; currency?: string; livemode?: boolean;
  expires_at?: string | null; failure_code?: string | null; metadata?: Record<string, unknown>;
  source?: { scannable_code?: { image?: { download_uri?: string } } };
  code?: string; message?: string;
};

function toCharge(c: OmiseCharge): ProviderCharge {
  if (c.object !== "charge" || !c.id || typeof c.amount !== "number" || !c.currency || !STATUSES.includes(c.status as ProviderChargeStatus)) {
    throw new ProviderError(`รูปแบบ charge จาก Provider ไม่ถูกต้อง${c.code ? ` (${c.code})` : ""}`, c.code);
  }
  return {
    id: c.id,
    status: c.status as ProviderChargeStatus,
    paid: c.paid === true,
    amountSatang: c.amount,
    currency: c.currency.toUpperCase(),
    livemode: c.livemode === true,
    expiresAt: c.expires_at ? new Date(c.expires_at) : null,
    qrImageUrl: c.source?.scannable_code?.image?.download_uri ?? null,
    failureCode: c.failure_code ?? null,
    metadata: Object.fromEntries(Object.entries(c.metadata ?? {}).map(([k, v]) => [k, String(v)])),
  };
}

export function createOpnProvider(opts: { secretKey: string; livemode: boolean; webhookSecret: string | null }): PaymentProvider {
  const auth = "Basic " + Buffer.from(`${opts.secretKey}:`).toString("base64");

  async function call(path: string, init: RequestInit & { idempotencyKey?: string } = {}): Promise<OmiseCharge> {
    let res: Response;
    try {
      res = await fetch(API + path, {
        ...init,
        headers: { Authorization: auth, ...(init.idempotencyKey ? { "Idempotency-Key": init.idempotencyKey } : {}), ...(init.body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
        signal: AbortSignal.timeout(15_000),
        cache: "no-store",
      });
    } catch (e) {
      throw new ProviderError(`เชื่อมต่อ Provider ไม่ได้: ${e instanceof Error ? e.message : String(e)}`);
    }
    const json = (await res.json().catch(() => ({}))) as OmiseCharge;
    if (!res.ok || json.object === "error") throw new ProviderError(`Provider ตอบข้อผิดพลาด ${res.status}${json.code ? ` (${json.code})` : ""}`, json.code);
    return json;
  }

  return {
    name: "opn",
    livemode: opts.livemode,

    async createPromptPayCharge(input: CreatePromptPayInput) {
      const body = new URLSearchParams({
        amount: String(input.amountSatang),
        currency: "THB",
        "source[type]": "promptpay",
        expires_at: input.expiresAt.toISOString(),
        description: input.description,
        ...Object.fromEntries(Object.entries(input.metadata).map(([k, v]) => [`metadata[${k}]`, v])),
      });
      return toCharge(await call("/charges", { method: "POST", body, idempotencyKey: input.idempotencyKey }));
    },

    async retrieveCharge(chargeId: string) {
      if (!/^chrg_[a-z0-9_]+$/i.test(chargeId)) throw new ProviderError("charge id ไม่ถูกต้อง");
      return toCharge(await call(`/charges/${chargeId}`));
    },

    verifyWebhookSignature(rawBody, headers) {
      if (!opts.webhookSecret) return { checked: false, valid: true };
      const sigHeader = headers.get("omise-signature");
      const ts = headers.get("omise-signature-timestamp");
      if (!sigHeader || !ts) return { checked: true, valid: false, reason: "ไม่มี signature" };
      const age = Math.abs(Date.now() / 1000 - Number(ts));
      if (!Number.isFinite(age) || age > 300) return { checked: true, valid: false, reason: "timestamp เกินช่วงที่ยอมรับ" };
      const expected = createHmac("sha256", Buffer.from(opts.webhookSecret, "base64")).update(`${ts}.${rawBody}`).digest();
      const ok = sigHeader.split(",").some((s) => {
        const got = Buffer.from(s.trim(), "hex");
        return got.length === expected.length && timingSafeEqual(got, expected);
      });
      return ok ? { checked: true, valid: true } : { checked: true, valid: false, reason: "signature ไม่ตรง" };
    },
  };
}
