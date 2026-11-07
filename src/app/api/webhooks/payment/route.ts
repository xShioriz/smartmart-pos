import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { handleProviderWebhook } from "@/server/services/payments";
import { syncNotifications } from "@/server/services/notifications";

export const dynamic = "force-dynamic";

const MAX_BODY = 100_000;

// Webhook ของ Payment Provider (ไม่มี session — proxy.ts ยกเว้นเส้นทางนี้)
// ความปลอดภัย: ตรวจ signature (ถ้าตั้ง secret) แล้ว "ไม่เชื่อ body" — ไปดึง Charge จาก Provider API เองก่อนเปลี่ยนสถานะ
export async function POST(req: Request) {
  const raw = await req.text();
  if (raw.length > MAX_BODY) return Response.json({ error: "payload too large" }, { status: 413 });
  const result = await handleProviderWebhook(raw, req.headers);
  if (result.status === 200 && result.body.outcome === "CONFIRMED") {
    after(async () => { try { await syncNotifications(); } catch (e) { console.error("[notifications sync]", e); } });
    revalidatePath("/inventory", "layout");
    revalidatePath("/sales");
  }
  return Response.json(result.body, { status: result.status });
}
