"use client";

import { useState, useTransition } from "react";
import { Loader2, LockKeyhole, Unlock } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatMoney } from "@/lib/money";
import { closeShiftAction, openShiftAction } from "./actions";

export function OpenShiftForm() {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="max-w-sm space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const v = String(new FormData(e.currentTarget).get("openingCash") ?? "");
        setError(null);
        start(async () => {
          const r = await openShiftAction({ openingCash: v });
          if (r.ok) toast.success(`เปิดกะ #${r.data.shiftNo} แล้ว`);
          else setError(r.error);
        });
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="openingCash">เงินทอนตั้งต้นในลิ้นชัก (บาท)</Label>
        <Input id="openingCash" name="openingCash" inputMode="decimal" required placeholder="เช่น 1000" autoComplete="off" />
        <p className="text-sm text-muted-foreground">นับเงินในลิ้นชักก่อนเริ่มขาย แล้วกรอกจำนวนที่นับได้</p>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={pending}>{pending ? <Loader2 className="animate-spin" /> : <Unlock />} เปิดกะ</Button>
    </form>
  );
}

export function CloseShiftForm({ shiftId, expected }: { shiftId: string; expected: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [counted, setCounted] = useState("");
  const valid = /^\d{1,7}(\.\d{1,2})?$/.test(counted.trim());
  const diff = valid ? Number(counted) - Number(expected) : null;
  const needNote = diff !== null && Math.abs(diff) >= 0.005;

  return (
    <form
      className="max-w-md space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const note = String(new FormData(e.currentTarget).get("note") ?? "");
        if (!window.confirm("ยืนยันปิดกะ? เมื่อปิดแล้วแก้ไขตัวเลขไม่ได้")) return;
        setError(null);
        start(async () => {
          const r = await closeShiftAction({ shiftId, countedCash: counted, note });
          if (r.ok) {
            const d = Number(r.data.difference);
            toast.success(d === 0 ? `ปิดกะ #${r.data.shiftNo} แล้ว — เงินตรง` : `ปิดกะ #${r.data.shiftNo} แล้ว — ${d < 0 ? "เงินขาด" : "เงินเกิน"} ${formatMoney(Math.abs(d))}`);
          } else setError(r.error);
        });
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="countedCash">เงินสดที่นับได้จริง (บาท)</Label>
        <Input id="countedCash" name="countedCash" inputMode="decimal" required value={counted} onChange={(e) => setCounted(e.target.value)} autoComplete="off" />
        {diff !== null && (
          <p className={`text-sm ${Math.abs(diff) < 0.005 ? "text-success" : "text-warning"}`} aria-live="polite">
            {Math.abs(diff) < 0.005 ? "ตรงกับยอดที่ควรมี" : `${diff < 0 ? "ขาด" : "เกิน"} ${formatMoney(Math.abs(diff))} (เทียบกับยอดที่แสดงตอนนี้ — ระบบคำนวณใหม่ตอนปิดกะ)`}
          </p>
        )}
      </div>
      <div className="space-y-2">
        <Label htmlFor="note">หมายเหตุ{needNote ? " (จำเป็น เพราะยอดไม่ตรง)" : " (ถ้ามี)"}</Label>
        <Input id="note" name="note" maxLength={300} required={needNote} placeholder="เช่น ทอนเงินเกิน 10 บาท" />
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={pending || !valid}>{pending ? <Loader2 className="animate-spin" /> : <LockKeyhole />} ปิดกะ</Button>
    </form>
  );
}
