"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, QrCode, RefreshCw, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/money";
import type { ActionResult } from "@/lib/result";
import type { QrState } from "@/server/services/payments";
import { cancelQrPaymentAction, getQrStatusAction, startQrPaymentAction } from "./actions";

export const QR_STORAGE_KEY = "smartmart.qr.v1";
const POLL_MS = 2500;

type Props = {
  items: { productId: string; quantity: number }[];
  totalLabel: string;
  initial: QrState | null; // กรณีกลับมาทำรายการที่ค้าง
  getKey: () => string;
  renewKey: () => void;
  onCompleted: (saleId: string) => void;
  onLockChange: (locked: boolean) => void; // QR ที่รอจ่ายอยู่ → ห้ามปิดหน้าต่างโดยไม่ยกเลิก
};

const mmss = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

export function QrPanel({ items, totalLabel, initial, getKey, renewKey, onCompleted, onLockChange }: Props) {
  const [qr, setQr] = useState<QrState | null>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const done = useRef(false);

  const apply = useCallback((s: QrState) => {
    setQr(s);
    if (s.status === "PENDING") {
      try { localStorage.setItem(QR_STORAGE_KEY, JSON.stringify({ paymentId: s.paymentId })); } catch { /* ignore */ }
      return;
    }
    try { localStorage.removeItem(QR_STORAGE_KEY); } catch { /* ignore */ }
    if (s.status === "PAID" && s.saleStatus === "COMPLETED" && !done.current) {
      done.current = true;
      toast.success("ได้รับเงินแล้ว ขายสำเร็จ");
      onCompleted(s.saleId);
    }
  }, [onCompleted]);

  const unwrap = useCallback(<T,>(res: ActionResult<T>): T | null => {
    if (res.ok) return res.data;
    setError(res.error);
    return null;
  }, []);

  const pending = qr?.status === "PENDING";
  useEffect(() => { onLockChange(!!pending); }, [pending, onLockChange]);

  // poll สถานะ (webhook เป็นทางหลัก; poll เป็นตัวสำรองและตัวอัปเดตหน้าจอ)
  useEffect(() => {
    if (!qr || qr.status !== "PENDING") return;
    const id = setInterval(async () => {
      setNow(Date.now());
      const s = unwrap(await getQrStatusAction({ paymentId: qr.paymentId }));
      if (s) apply(s);
    }, POLL_MS);
    return () => clearInterval(id);
  }, [qr, apply, unwrap]);

  useEffect(() => {
    if (!pending) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [pending]);

  async function create() {
    setBusy(true); setError(null);
    const s = unwrap(await startQrPaymentAction({ idempotencyKey: getKey(), items }));
    setBusy(false);
    if (s) apply(s);
  }

  async function check() {
    if (!qr) return;
    setBusy(true); setError(null);
    const s = unwrap(await getQrStatusAction({ paymentId: qr.paymentId }));
    setBusy(false);
    if (s) apply(s);
  }

  async function cancel() {
    if (!qr) return;
    setBusy(true); setError(null);
    const s = unwrap(await cancelQrPaymentAction({ paymentId: qr.paymentId }));
    setBusy(false);
    if (!s) return;
    if (s.status === "FAILED" && s.failureReason === "CANCELLED_BY_CASHIER") {
      toast.info("ยกเลิก QR แล้ว (ถ้าลูกค้าสแกนจ่ายก่อนหมดเวลา ระบบยังรับเงินและแจ้งให้ตรวจสอบ)");
      renewKey();
      setQr(null);
      try { localStorage.removeItem(QR_STORAGE_KEY); } catch { /* ignore */ }
    } else apply(s);
  }

  const sandbox = qr?.environment === "SANDBOX" || (!qr && true);

  // ยังไม่ได้สร้าง QR
  if (!qr) {
    return (
      <div className="space-y-4">
        <div className="rounded-xl bg-green-50 p-4 text-center">
          <p className="text-sm text-green-800">ยอดที่ต้องชำระ</p>
          <p className="text-4xl font-bold text-green-700 tabular-nums">{totalLabel}</p>
        </div>
        <p className="text-sm text-muted-foreground">สร้าง QR PromptPay ตามยอดบิล ลูกค้าสแกนจ่าย ระบบจะยืนยันกับ Provider อัตโนมัติ ยังไม่ตัดสต็อกจนกว่าจะได้รับเงินจริง (ยอด 20 – 150,000 บาท)</p>
        {error && <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
        <Button type="button" className="h-11 w-full text-base" onClick={create} disabled={busy}>
          {busy ? <Loader2 className="animate-spin" /> : <QrCode />} สร้าง QR PromptPay
        </Button>
      </div>
    );
  }

  const remaining = qr.expiresAt ? new Date(qr.expiresAt).getTime() - now : null;

  return (
    <div className="space-y-4">
      {qr.environment === "SANDBOX" && sandbox && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-center text-sm font-medium text-amber-900">SANDBOX — โหมดทดสอบ ไม่ใช่เงินจริง</p>
      )}

      {pending && (
        <>
          <div className="flex flex-col items-center gap-2">
            {qr.qrImageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qr.qrImageUrl} alt="QR PromptPay สำหรับชำระเงิน" className="size-56 rounded-lg border bg-white object-contain p-2" />
            )}
            <p className="text-2xl font-bold tabular-nums text-primary">{formatMoney(qr.amount)}</p>
            <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> รอลูกค้าชำระเงิน{remaining !== null && ` · หมดอายุใน ${mmss(remaining)}`}</p>
          </div>
          {error && <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button type="button" variant="outline" className="flex-1" onClick={check} disabled={busy}><RefreshCw className={cn(busy && "animate-spin")} /> ตรวจสอบสถานะ</Button>
            <Button type="button" variant="outline" className="flex-1" onClick={cancel} disabled={busy}>ยกเลิก QR</Button>
          </div>
        </>
      )}

      {qr.status === "PAID" && qr.saleStatus === "COMPLETED" && (
        <div className="flex flex-col items-center gap-2 py-4 text-green-700"><CheckCircle2 className="size-12" /><p className="font-semibold">ได้รับเงินแล้ว กำลังเปิดใบเสร็จ…</p></div>
      )}

      {qr.status === "PAID" && qr.saleStatus === "PAID_NEEDS_REVIEW" && (
        <div className="space-y-2 rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-900">
          <p className="flex items-center gap-2 font-semibold"><AlertTriangle className="size-5" /> ได้รับเงินแล้ว แต่สต็อกไม่พอสำหรับตัดขาย</p>
          <p>บิลนี้ถูกส่งให้ผู้ดูแลระบบตรวจสอบ (คืนเงินลูกค้าหรือทำรายการต่อ) กรุณาอย่าให้ลูกค้ารับสินค้า</p>
          <Button type="button" className="w-full" onClick={() => { setQr(null); renewKey(); onCompleted(""); }}>รับทราบ</Button>
        </div>
      )}

      {(qr.status === "FAILED" || qr.status === "EXPIRED") && (
        <div className="space-y-3 rounded-lg border bg-muted/40 p-4 text-center">
          <XCircle className="mx-auto size-10 text-destructive" />
          <p className="font-semibold">{qr.status === "EXPIRED" ? "QR หมดอายุ" : "ชำระเงินไม่สำเร็จ"}</p>
          <Button type="button" className="w-full" onClick={() => { renewKey(); setQr(null); setError(null); }}><RefreshCw /> สร้าง QR ใหม่</Button>
        </div>
      )}
    </div>
  );
}
