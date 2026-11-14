"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { resolveReviewAction } from "../actions";

export function ResolveReview({ saleId }: { saleId: string }) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function run(action: "FULFILL" | "REFUNDED") {
    setError(null);
    start(async () => {
      const res = await resolveReviewAction({ saleId, action, note });
      if (res.ok) toast.success(action === "FULFILL" ? "ตัดสต็อกและปิดบิลแล้ว" : "บันทึกการคืนเงินแล้ว");
      else setError(res.error);
    });
  }

  return (
    <div className="space-y-3 rounded-xl border border-danger/30 bg-danger-soft p-4">
      <p className="font-semibold text-danger">ลูกค้าจ่ายเงินแล้ว แต่ระบบตัดสต็อกไม่ได้ (สต็อกไม่พอ) — ต้องดำเนินการ</p>
      <p className="text-sm text-danger">เลือกทำรายการต่อ (หลังเติมสต็อกแล้ว) หรือคืนเงินลูกค้าด้วยการโอนคืนนอกระบบ (Provider ไม่รองรับการคืนเงิน PromptPay) แล้วบันทึกที่นี่</p>
      <div className="space-y-2">
        <Label htmlFor="note">หมายเหตุ (บังคับ)</Label>
        <Input id="note" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="เช่น โอนคืนลูกค้าแล้วเมื่อ 14:30" />
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={pending || !note.trim()} onClick={() => run("FULFILL")}>เติมสต็อกแล้ว — ตัดสต็อกและปิดบิล</Button>
        <Button type="button" variant="outline" disabled={pending || !note.trim()} onClick={() => run("REFUNDED")}>คืนเงินลูกค้าแล้ว — ยกเลิกบิล</Button>
      </div>
    </div>
  );
}
