"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Loader2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatMoney } from "@/lib/money";
import { previewReturnAction, returnSaleAction } from "../actions";

type Item = { id: string; name: string; quantity: number; returnedQty: number };
type Preview = { refundTotal: string; pointsToReverse: number; lines: { saleItemId: string; refund: string }[] };

export function ReturnDialog({ saleId, items, isQr }: { saleId: string; items: Item[]; isQr: boolean }) {
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [restock, setRestock] = useState<Record<string, boolean>>({});
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const key = useRef<string>("");
  const seq = useRef(0);

  const lines = items
    .map((i) => ({ saleItemId: i.id, quantity: Math.max(0, Math.min(i.quantity - i.returnedQty, parseInt(qty[i.id] || "0", 10) || 0)), restock: restock[i.id] ?? true }))
    .filter((l) => l.quantity > 0);
  const sig = JSON.stringify(lines);

  // ตัวอย่างเงินคืน/แต้มที่จะหัก คำนวณโดยเซิร์ฟเวอร์ด้วยสูตรเดียวกับตอนคืนจริง
  useEffect(() => {
    if (!open || lines.length === 0) return;
    const my = ++seq.current;
    const t = setTimeout(async () => {
      const res = await previewReturnAction({ saleId, items: lines });
      if (my !== seq.current) return;
      if (res.ok) { setPreview(res.data); setPreviewError(null); } else { setPreview(null); setPreviewError(res.error); }
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, open, saleId]);

  function reset() { setQty({}); setRestock({}); setReason(""); setNote(""); setPreview(null); setPreviewError(null); setError(null); key.current = crypto.randomUUID(); }
  function openDialog() { reset(); setOpen(true); }

  function submit() {
    setError(null);
    start(async () => {
      const res = await returnSaleAction({ saleId, items: lines, reason, refundNote: note, idempotencyKey: key.current });
      if (res.ok) {
        toast.success(`บันทึกการคืน ${res.data.returnNo} · คืนเงิน ${formatMoney(res.data.refundTotal)}${res.data.pointsReversed ? ` · หักแต้ม ${res.data.pointsReversed}` : ""}`);
        setOpen(false);
      } else setError(res.error);
    });
  }

  const hasLines = lines.length > 0;
  const previewFor = (id: string) => preview?.lines.find((l) => l.saleItemId === id)?.refund;

  return (
    <>
      <Button variant="outline" onClick={openDialog}><Undo2 /> คืนสินค้า</Button>
      <Dialog open={open} onOpenChange={(o) => { if (!pending) setOpen(o); }}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>คืนสินค้า / คืนเงิน</DialogTitle>
            <DialogDescription>เงินคืนคิดจากยอดที่ลูกค้าจ่ายจริงของแต่ละรายการ (หลังส่วนลด) · สินค้าที่คืนเข้าสต็อกจะกลับไปยังล็อตเดิม</DialogDescription>
          </DialogHeader>
          <div className="max-h-72 space-y-2 overflow-y-auto">
            {items.map((i) => {
              const left = i.quantity - i.returnedQty;
              return (
                <div key={i.id} className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-lg border p-3 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{i.name}</p>
                    <p className="text-sm text-muted-foreground">ซื้อ {i.quantity} · คืนแล้ว {i.returnedQty} · คืนได้อีก {left}</p>
                    {left > 0 && (
                      <label className="mt-1 flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={restock[i.id] ?? true} onChange={(e) => setRestock((s) => ({ ...s, [i.id]: e.target.checked }))} /> คืนเข้าสต็อก (ไม่ติ๊ก = ของเสีย ไม่กลับเข้าสต็อก)
                      </label>
                    )}
                  </div>
                  {left > 0 ? (
                    <div className="text-right">
                      <Input inputMode="numeric" aria-label={`จำนวนที่คืน ${i.name}`} placeholder="0" className="h-8 w-20 text-center" value={qty[i.id] ?? ""} onChange={(e) => setQty((s) => ({ ...s, [i.id]: e.target.value.replace(/\D/g, "") }))} />
                      {previewFor(i.id) && <p className="mt-1 text-sm tabular-nums text-success">คืน {formatMoney(previewFor(i.id)!)}</p>}
                    </div>
                  ) : <span className="text-sm text-muted-foreground">คืนครบแล้ว</span>}
                </div>
              );
            })}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2"><Label htmlFor="reason">เหตุผลการคืน (บังคับ)</Label><Input id="reason" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="note">{isQr ? "หมายเหตุการโอนเงินคืน (บังคับ)" : "หมายเหตุ (ไม่บังคับ)"}</Label><Input id="note" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} placeholder={isQr ? "เช่น โอนคืนเข้าบัญชีลูกค้า 14:30" : ""} /></div>
          </div>
          {isQr && <p className="rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">บิลนี้จ่ายด้วย PromptPay QR — ระบบไม่คืนเงินผ่าน Provider ให้โอนคืนลูกค้านอกระบบ แล้วบันทึกหมายเหตุที่นี่</p>}
          <div className="flex items-baseline justify-between rounded-lg border bg-muted/40 p-3">
            <span className="text-sm">{isQr ? "ยอดที่ต้องโอนคืน" : "ยอดที่ต้องคืนเงินสด"}{preview && preview.pointsToReverse > 0 ? ` · หักแต้ม ${preview.pointsToReverse}` : ""}</span>
            <span className="text-2xl font-bold tabular-nums text-primary">{preview && hasLines ? formatMoney(preview.refundTotal) : "-"}</span>
          </div>
          {(error || previewError) && <p role="alert" className="text-sm text-destructive">{error ?? previewError}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={() => setOpen(false)}>ยกเลิก</Button>
            <Button type="button" disabled={pending || !hasLines || !preview || !reason.trim() || (isQr && !note.trim())} onClick={submit}>{pending && <Loader2 className="animate-spin" />} ยืนยันการคืน</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
