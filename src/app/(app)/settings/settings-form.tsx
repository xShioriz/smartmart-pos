"use client";

import { useState, useTransition } from "react";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { SettingsInput } from "@/lib/validators/settings";
import { updateSettingsAction } from "./actions";

type Pay = { enabled: boolean; environment: "SANDBOX" | "PRODUCTION" | null; reason?: string };

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function SettingsForm({ initial, payment }: { initial: SettingsInput; payment: Pay }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="max-w-3xl space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const v = (k: string) => String(f.get(k) ?? "");
        setError(null);
        start(async () => {
          const res = await updateSettingsAction({
            store_name: v("store_name"), store_address: v("store_address"), store_phone: v("store_phone"), receipt_footer: v("receipt_footer"),
            points_per_baht: v("points_per_baht"), near_expiry_days: v("near_expiry_days"), qr_expire_minutes: v("qr_expire_minutes"),
          });
          if (res.ok) toast.success(res.data.changed ? `บันทึกแล้ว (${res.data.changed} รายการ)` : "ไม่มีการเปลี่ยนแปลง");
          else setError(res.error);
        });
      }}
    >
      <section className="space-y-4 rounded-xl border bg-card p-5">
        <h2 className="font-semibold">ข้อมูลร้านและใบเสร็จ</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="store_name" label="ชื่อร้าน"><Input id="store_name" name="store_name" required maxLength={80} defaultValue={initial.store_name} /></Field>
          <Field id="store_phone" label="เบอร์โทร"><Input id="store_phone" name="store_phone" maxLength={30} defaultValue={initial.store_phone} /></Field>
          <div className="sm:col-span-2"><Field id="store_address" label="ที่อยู่"><Input id="store_address" name="store_address" maxLength={200} defaultValue={initial.store_address} /></Field></div>
          <div className="sm:col-span-2"><Field id="receipt_footer" label="ข้อความท้ายใบเสร็จ"><Input id="receipt_footer" name="receipt_footer" maxLength={200} defaultValue={initial.receipt_footer} /></Field></div>
        </div>
      </section>

      <section className="space-y-4 rounded-xl border bg-card p-5">
        <h2 className="font-semibold">สมาชิกและสต็อก</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="points_per_baht" label="ซื้อกี่บาทได้ 1 แต้ม" hint="ปัดเศษลง เช่น 25 → ซื้อ 100 บาทได้ 4 แต้ม (มีผลกับบิลถัดไป)"><Input id="points_per_baht" name="points_per_baht" inputMode="numeric" required defaultValue={initial.points_per_baht} /></Field>
          <Field id="near_expiry_days" label="เตือนใกล้หมดอายุล่วงหน้า (วัน)" hint="ใช้กับแจ้งเตือน หน้าคลังสินค้า และ Smart BI"><Input id="near_expiry_days" name="near_expiry_days" inputMode="numeric" required defaultValue={initial.near_expiry_days} /></Field>
        </div>
      </section>

      <section className="space-y-4 rounded-xl border bg-card p-5">
        <h2 className="font-semibold">การชำระเงินด้วย PromptPay QR</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="qr_expire_minutes" label="QR หมดอายุภายใน (นาที)" hint="2–60 นาที มีผลกับ QR ที่สร้างหลังจากนี้"><Input id="qr_expire_minutes" name="qr_expire_minutes" inputMode="numeric" required defaultValue={initial.qr_expire_minutes} /></Field>
          <div className="space-y-2">
            <Label>สถานะผู้ให้บริการ (อ่านอย่างเดียว)</Label>
            <p className="flex flex-wrap items-center gap-2 text-sm">
              {payment.enabled ? (
                <>
                  <Badge className="bg-green-100 text-green-800">พร้อมใช้งาน</Badge>
                  <Badge variant={payment.environment === "SANDBOX" ? "secondary" : "default"}>{payment.environment === "SANDBOX" ? "SANDBOX — โหมดทดสอบ ไม่ใช่เงินจริง" : "Production"}</Badge>
                </>
              ) : <Badge variant="destructive">ยังใช้ไม่ได้</Badge>}
            </p>
            {!payment.enabled && payment.reason && <p className="text-xs text-muted-foreground">{payment.reason}</p>}
            <p className="text-xs text-muted-foreground">คีย์ของ Provider ตั้งที่ Environment Variables ของเซิร์ฟเวอร์เท่านั้น ไม่แสดงและแก้ไขในหน้านี้</p>
          </div>
        </div>
      </section>

      {error && <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={pending}>{pending ? <Loader2 className="animate-spin" /> : <Save />} บันทึกการตั้งค่า</Button>
    </form>
  );
}
