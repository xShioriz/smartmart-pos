"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Minus, Plus, Search, ShoppingCart, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/money";
import type { PosProduct } from "@/server/services/pos";
import { checkoutCashAction } from "./actions";

type CartLine = { productId: string; qty: number };
type Action =
  | { type: "hydrate"; lines: CartLine[] }
  | { type: "set"; productId: string; qty: number }
  | { type: "remove"; productId: string }
  | { type: "clear" };

const MAX_QTY = 9999;
const STORAGE_KEY = "smartmart.cart.v1";

function reducer(state: CartLine[], a: Action): CartLine[] {
  switch (a.type) {
    case "hydrate": return a.lines;
    case "set": {
      if (a.qty <= 0) return state.filter((l) => l.productId !== a.productId);
      return state.some((l) => l.productId === a.productId)
        ? state.map((l) => (l.productId === a.productId ? { ...l, qty: a.qty } : l))
        : [...state, { productId: a.productId, qty: a.qty }];
    }
    case "remove": return state.filter((l) => l.productId !== a.productId);
    case "clear": return [];
  }
}

// ราคาเป็นสตริง 2 ตำแหน่ง → สตางค์ (จำนวนเต็ม) เพื่อให้ยอดที่แสดงตรงเสมอ ไม่ใช้ float สะสม
const satang = (price: string) => Math.round(Number(price) * 100);
const baht = (s: number) => formatMoney(s / 100);
const parseMoneyToSatang = (v: string) => (/^\d{1,9}(\.\d{1,2})?$/.test(v.trim()) ? Math.round(Number(v) * 100) : null);

export function PosTerminal({ products }: { products: PosProduct[] }) {
  const router = useRouter();
  const [cart, dispatch] = useReducer(reducer, []);
  const hydrated = useRef(false);
  const [query, setQuery] = useState("");
  const [categoryId, setCategoryId] = useState<string>("all");
  const [payOpen, setPayOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [paid, setPaid] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const searchRef = useRef<HTMLInputElement>(null);
  const idemKey = useRef<string | null>(null);

  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  // โหลดตะกร้าที่ค้างไว้ (ตัดสินค้าที่ไม่มีแล้ว และจำกัดจำนวนไม่เกินที่ขายได้ตอนนี้)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as CartLine[];
        const lines = saved
          .filter((l) => byId.has(l.productId) && Number.isInteger(l.qty) && l.qty > 0)
          .map((l) => ({ productId: l.productId, qty: Math.min(l.qty, byId.get(l.productId)!.sellable, MAX_QTY) }))
          .filter((l) => l.qty > 0);
        if (lines.length) dispatch({ type: "hydrate", lines });
        if (lines.length !== saved.length || lines.some((l, i) => l.qty !== saved[i]?.qty)) toast.info("ตะกร้าที่ค้างไว้ถูกปรับตามสต็อกปัจจุบัน");
      }
    } catch { /* localStorage ใช้ไม่ได้ → ทำงานต่อโดยไม่จำตะกร้า */ }
    hydrated.current = true;
  }, [byId]);

  useEffect(() => {
    if (!hydrated.current) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cart)); } catch { /* ignore */ }
    idemKey.current = null; // ตะกร้าเปลี่ยน = คำขอใหม่
  }, [cart]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F2") { e.preventDefault(); searchRef.current?.focus(); searchRef.current?.select(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const qtyOf = useCallback((id: string) => cart.find((l) => l.productId === id)?.qty ?? 0, [cart]);

  const setQty = useCallback((p: PosProduct, qty: number) => {
    if (qty > p.sellable) { toast.warning(`สต็อกไม่พอ: ${p.name} ขายได้ ${p.sellable} ${p.unit}`); qty = p.sellable; }
    dispatch({ type: "set", productId: p.id, qty: Math.min(qty, MAX_QTY) });
  }, []);

  const add = useCallback((p: PosProduct) => {
    if (p.sellable <= 0) { toast.warning(`${p.name} หมดสต็อก`); return; }
    setQty(p, qtyOf(p.id) + 1);
  }, [qtyOf, setQty]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter((p) =>
      (categoryId === "all" || p.categoryId === categoryId) &&
      (!q || p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || (p.barcode ?? "").includes(q)));
  }, [products, query, categoryId]);

  const categories = useMemo(() => {
    const m = new Map<string, string>();
    products.forEach((p) => m.set(p.categoryId, p.categoryName));
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], "th"));
  }, [products]);

  function onSearchEnter() {
    const q = query.trim().toLowerCase();
    if (!q) return;
    const exact = products.find((p) => p.sku.toLowerCase() === q || p.barcode === query.trim());
    const hit = exact ?? (filtered.length === 1 ? filtered[0] : undefined);
    if (hit) { add(hit); setQuery(""); } else toast.error(filtered.length ? "พบหลายรายการ กรุณาเลือกจากรายการ" : "ไม่พบสินค้า");
  }

  const lines = cart.map((l) => ({ ...l, p: byId.get(l.productId)! })).filter((l) => l.p);
  const totalSatang = lines.reduce((s, l) => s + satang(l.p.price) * l.qty, 0);
  const itemCount = lines.reduce((s, l) => s + l.qty, 0);
  const paidSatang = parseMoneyToSatang(paid);
  const enough = paidSatang !== null && paidSatang >= totalSatang;

  function openPay() {
    if (!lines.length) return;
    idemKey.current ??= crypto.randomUUID();
    setPaid(""); setError(null); setPayOpen(true);
  }

  function confirmPay() {
    if (!enough || paidSatang === null || !idemKey.current) return;
    setError(null);
    const key = idemKey.current;
    start(async () => {
      const res = await checkoutCashAction({
        idempotencyKey: key,
        items: lines.map((l) => ({ productId: l.productId, quantity: l.qty })),
        amountPaid: (paidSatang / 100).toFixed(2),
      });
      if (res.ok) {
        toast.success(`ขายสำเร็จ เงินทอน ${formatMoney(res.data.change)}`);
        dispatch({ type: "clear" });
        setPayOpen(false);
        router.push(`/receipt/${res.data.saleId}`);
      } else {
        setError(res.error);
        router.refresh(); // รีเฟรชสต็อกล่าสุดเผื่อสาเหตุคือสต็อกไม่พอ
      }
    });
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(320px,2fr)]">
      {/* ซ้าย: ค้นหา + สินค้า */}
      <section className="min-w-0">
        <div className="relative mb-3">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onSearchEnter(); } }}
            placeholder="สแกนบาร์โค้ด / พิมพ์ SKU หรือชื่อสินค้า"
            aria-label="ค้นหาสินค้า"
            className="h-10 pl-9 text-base"
            autoFocus
          />
          {query && (
            <button type="button" onClick={() => { setQuery(""); searchRef.current?.focus(); }} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-muted" aria-label="ล้างคำค้น"><X className="size-4" /></button>
          )}
        </div>
        <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
          {[["all", "ทั้งหมด"] as const, ...categories].map(([id, name]) => (
            <button key={id} type="button" onClick={() => setCategoryId(id)}
              className={cn("shrink-0 rounded-full border px-3 py-1 text-sm", categoryId === id ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted")}>
              {name}
            </button>
          ))}
        </div>
        {filtered.length === 0 ? (
          <p className="rounded-xl border border-dashed bg-card p-10 text-center text-sm text-muted-foreground">ไม่พบสินค้าที่ตรงกับคำค้น</p>
        ) : (
          <div className="grid max-h-[calc(100vh-17rem)] grid-cols-2 gap-3 overflow-y-auto pr-1 md:grid-cols-3 xl:grid-cols-4">
            {filtered.map((p) => {
              const inCart = qtyOf(p.id);
              const out = p.sellable <= 0;
              return (
                <button key={p.id} type="button" onClick={() => add(p)} disabled={out}
                  className={cn("relative flex flex-col items-start gap-1 rounded-xl border bg-card p-3 text-left transition hover:border-primary hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-50", inCart > 0 && "border-primary ring-1 ring-primary")}>
                  {inCart > 0 && <span className="absolute right-2 top-2 rounded-full bg-primary px-2 text-xs font-medium text-primary-foreground">{inCart}</span>}
                  <span className="line-clamp-2 min-h-10 pr-6 text-sm font-medium leading-5">{p.name}</span>
                  <span className="font-mono text-[11px] text-muted-foreground">{p.sku}</span>
                  <span className="mt-1 text-base font-semibold text-primary tabular-nums">{formatMoney(p.price)}</span>
                  <span className={cn("text-xs", out ? "text-destructive" : p.sellable <= 5 ? "text-amber-700" : "text-muted-foreground")}>{out ? "หมด" : `เหลือ ${p.sellable} ${p.unit}`}</span>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* ขวา: ตะกร้า */}
      <aside className="flex max-h-[calc(100vh-9rem)] flex-col rounded-xl border bg-card lg:sticky lg:top-4" aria-label="ตะกร้าสินค้า">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="flex items-center gap-2 font-semibold"><ShoppingCart className="size-4" /> ตะกร้า <span className="text-sm font-normal text-muted-foreground">({lines.length} รายการ / {itemCount} ชิ้น)</span></h2>
          {lines.length > 0 && <Button variant="ghost" size="sm" onClick={() => setClearOpen(true)}><Trash2 /> ล้าง</Button>}
        </div>
        <div className="min-h-32 flex-1 overflow-y-auto">
          {lines.length === 0 ? (
            <div className="flex h-full min-h-40 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
              <ShoppingCart className="size-8 opacity-40" />
              ตะกร้าว่าง — สแกนหรือเลือกสินค้าเพื่อเริ่มขาย
            </div>
          ) : (
            <ul className="divide-y">
              {lines.map(({ p, qty }) => (
                <li key={p.id} className="space-y-2 px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0"><p className="truncate text-sm font-medium">{p.name}</p><p className="text-xs text-muted-foreground">{formatMoney(p.price)} / {p.unit}</p></div>
                    <button type="button" onClick={() => dispatch({ type: "remove", productId: p.id })} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive" aria-label={`ลบ ${p.name}`}><X className="size-4" /></button>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1">
                      <Button size="icon-sm" variant="outline" onClick={() => setQty(p, qty - 1)} aria-label="ลดจำนวน"><Minus /></Button>
                      <Input
                        value={qty}
                        inputMode="numeric"
                        aria-label={`จำนวน ${p.name}`}
                        className="h-7 w-14 px-1 text-center tabular-nums"
                        onChange={(e) => { const n = parseInt(e.target.value.replace(/\D/g, ""), 10); if (!Number.isNaN(n)) setQty(p, n); }}
                      />
                      <Button size="icon-sm" variant="outline" onClick={() => setQty(p, qty + 1)} aria-label="เพิ่มจำนวน"><Plus /></Button>
                    </div>
                    <span className="font-medium tabular-nums">{baht(satang(p.price) * qty)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="space-y-3 border-t p-4">
          <div className="flex items-baseline justify-between"><span className="text-sm text-muted-foreground">ยอดรวม (ก่อนส่วนลด)</span><span className="tabular-nums">{baht(totalSatang)}</span></div>
          <div className="flex items-baseline justify-between"><span className="font-semibold">ยอดสุทธิ</span><span className="text-2xl font-bold text-primary tabular-nums">{baht(totalSatang)}</span></div>
          <Button className="h-11 w-full text-base" disabled={!lines.length} onClick={openPay}>ชำระเงินสด</Button>
          <p className="text-center text-[11px] text-muted-foreground">ยอดจริงคำนวณจากราคาในระบบอีกครั้งตอนยืนยัน</p>
        </div>
      </aside>

      {/* ชำระเงิน */}
      <Dialog open={payOpen} onOpenChange={(o) => { if (!pending) setPayOpen(o); }}>
        <DialogContent>
          <form onSubmit={(e) => { e.preventDefault(); confirmPay(); }} className="space-y-4">
            <DialogHeader>
              <DialogTitle>ชำระเงินสด</DialogTitle>
              <DialogDescription>{lines.length} รายการ / {itemCount} ชิ้น</DialogDescription>
            </DialogHeader>
            <div className="rounded-xl bg-green-50 p-4 text-center">
              <p className="text-sm text-green-800">ยอดที่ต้องชำระ</p>
              <p className="text-4xl font-bold text-green-700 tabular-nums">{baht(totalSatang)}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="paid">รับเงินมา (บาท)</Label>
              <Input id="paid" value={paid} onChange={(e) => setPaid(e.target.value)} inputMode="decimal" autoFocus autoComplete="off" className="h-11 text-lg tabular-nums" aria-invalid={paid !== "" && paidSatang === null} />
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setPaid((totalSatang / 100).toFixed(2))}>พอดี</Button>
                {[100, 500, 1000].map((v) => <Button key={v} type="button" variant="outline" size="sm" onClick={() => setPaid(String(v))}>฿{v.toLocaleString("th-TH")}</Button>)}
              </div>
            </div>
            <div className={cn("flex items-baseline justify-between rounded-lg border p-3", enough ? "border-green-300 bg-green-50" : "bg-muted/40")}>
              <span className="text-sm">{paidSatang === null ? "เงินทอน" : enough ? "เงินทอน" : "ยังขาด"}</span>
              <span className={cn("text-2xl font-bold tabular-nums", enough ? "text-green-700" : "text-destructive")}>
                {paidSatang === null ? "-" : baht(Math.abs(paidSatang - totalSatang))}
              </span>
            </div>
            {error && <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" disabled={pending} onClick={() => setPayOpen(false)}>ยกเลิก</Button>
              <Button type="submit" disabled={!enough || pending} className="min-w-32">{pending && <Loader2 className="animate-spin" />} ยืนยันการขาย</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={clearOpen} onOpenChange={setClearOpen}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>ล้างตะกร้า?</AlertDialogTitle><AlertDialogDescription>รายการสินค้าทั้งหมดในตะกร้าจะถูกนำออก</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
            <AlertDialogAction onClick={() => { dispatch({ type: "clear" }); searchRef.current?.focus(); }}>ล้างตะกร้า</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
