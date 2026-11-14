"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Banknote, Delete, Loader2, Minus, Plus, QrCode, Search, ShoppingCart, Star, Tag, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/money";
import type { PosProduct } from "@/server/services/pos";
import type { QrState } from "@/server/services/payments";
import type { Quote } from "@/server/services/quote";
import { checkoutCashAction, getQrStatusAction, quoteCartAction } from "./actions";
import { MemberPicker, type PickedMember } from "./member-picker";
import { QR_STORAGE_KEY, QrPanel } from "./qr-panel";

type CartLine = { productId: string; qty: number };
type Action =
  | { type: "hydrate"; lines: CartLine[] }
  | { type: "set"; productId: string; qty: number }
  | { type: "remove"; productId: string }
  | { type: "clear" };

const MAX_QTY = 9999;
const STORAGE_KEY = "smartmart.cart.v1";
const MEMBER_KEY = "smartmart.member.v1";

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

export type PaymentInfo = { enabled: boolean; environment: "SANDBOX" | "PRODUCTION" | null; reason?: string };

export function PosTerminal({ products, payment }: { products: PosProduct[]; payment: PaymentInfo }) {
  const router = useRouter();
  const [cart, dispatch] = useReducer(reducer, []);
  const hydrated = useRef(false);
  const [query, setQuery] = useState("");
  const [categoryId, setCategoryId] = useState<string>("all");
  const [payOpen, setPayOpen] = useState(false);
  const [method, setMethod] = useState<"cash" | "qr">("cash");
  const [qrLocked, setQrLocked] = useState(false);
  const [qrInitial, setQrInitial] = useState<QrState | null>(null);
  const [clearOpen, setClearOpen] = useState(false);
  const [cartOpen, setCartOpen] = useState(false); // เฉพาะจอเล็ก (< lg): ตะกร้าเป็นแผงเต็มจอที่เปิดจากแถบด้านล่าง
  const [paid, setPaid] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const searchRef = useRef<HTMLInputElement>(null);
  const idemKey = useRef<string | null>(null);
  const [member, setMember] = useReducer((_: PickedMember | null, next: PickedMember | null) => next, null);
  // ตัวอย่างราคาจากเซิร์ฟเวอร์ (โปรโมชั่น/ส่วนลดคิดฝั่งเซิร์ฟเวอร์เท่านั้น) — key = ตะกร้า+สมาชิกที่ใช้คำนวณ
  const [quote, setQuote] = useState<{ key: string; data: Quote | null; error: string | null } | null>(null);
  const quoteSeq = useRef(0);

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
    try { const raw = localStorage.getItem(MEMBER_KEY); if (raw) setMember(JSON.parse(raw)); } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    try { if (member) localStorage.setItem(MEMBER_KEY, JSON.stringify(member)); else localStorage.removeItem(MEMBER_KEY); } catch { /* ignore */ }
    idemKey.current = null; // เปลี่ยนสมาชิก = คำขอใหม่
  }, [member]);

  const cartKey = JSON.stringify([cart.map((l) => [l.productId, l.qty]), member?.id ?? null]);
  useEffect(() => {
    if (!hydrated.current || cart.length === 0) return;
    const my = ++quoteSeq.current;
    const t = setTimeout(async () => {
      const res = await quoteCartAction({ items: cart.map((l) => ({ productId: l.productId, quantity: l.qty })), memberId: member?.id ?? null });
      if (my !== quoteSeq.current) return; // ทิ้งผลของตะกร้าที่เก่ากว่า
      setQuote({ key: cartKey, data: res.ok ? res.data : null, error: res.ok ? null : res.error });
    }, 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cartKey]);

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
  const grossSatang = lines.reduce((s, l) => s + satang(l.p.price) * l.qty, 0);
  const q = quote && quote.key === cartKey ? quote : null; // ตัวอย่างราคาที่ตรงกับตะกร้าปัจจุบัน
  const quoteReady = !!q?.data && lines.length > 0;
  const totalSatang = quoteReady ? Math.round(Number(q!.data!.total) * 100) : grossSatang;
  const quoteLine = (id: string) => q?.data?.lines.find((l) => l.productId === id);
  const itemCount = lines.reduce((s, l) => s + l.qty, 0);
  const paidSatang = parseMoneyToSatang(paid);
  const enough = paidSatang !== null && paidSatang >= totalSatang;

  /** แป้นตัวเลขบนจอ: รับเฉพาะรูปแบบเงินที่ถูกต้อง (จำนวนเต็มไม่เกิน 7 หลัก ทศนิยมไม่เกิน 2 ตำแหน่ง) */
  function pressKey(k: string) {
    setPaid((cur) => {
      if (k === "back") return cur.slice(0, -1);
      if (k === ".") return cur.includes(".") ? cur : (cur || "0") + ".";
      const next = cur === "0" ? k : cur + k;
      return /^\d{1,7}(\.\d{0,2})?$/.test(next) ? next : cur;
    });
  }

  function openPay() {
    if (!lines.length) return;
    idemKey.current ??= crypto.randomUUID();
    setPaid(""); setError(null); setMethod("cash"); setPayOpen(true);
  }

  function confirmPay() {
    if (!quoteReady || !enough || paidSatang === null || !idemKey.current) return;
    setError(null);
    const key = idemKey.current;
    start(async () => {
      const res = await checkoutCashAction({
        idempotencyKey: key,
        items: lines.map((l) => ({ productId: l.productId, quantity: l.qty })),
        amountPaid: (paidSatang / 100).toFixed(2),
        memberId: member?.id ?? null,
        expectedTotal: q!.data!.total,
      });
      if (res.ok) {
        toast.success(`ขายสำเร็จ เงินทอน ${formatMoney(res.data.change)}${res.data.pointsEarned ? ` · ได้ ${res.data.pointsEarned} แต้ม` : ""}`);
        dispatch({ type: "clear" });
        setMember(null);
        setPayOpen(false);
        router.push(`/receipt/${res.data.saleId}`);
      } else {
        setError(res.error);
        setQuote(null); // ราคา/โปรเปลี่ยน → บังคับคำนวณยอดใหม่ก่อนชำระอีกครั้ง
        quoteSeq.current++;
        setQuote({ key: "", data: null, error: null });
        router.refresh(); // รีเฟรชสต็อกล่าสุดเผื่อสาเหตุคือสต็อกไม่พอ
      }
    });
  }

  // กลับมาทำรายการ QR ที่ค้างอยู่ (รีเฟรช/ปิดแท็บระหว่างรอลูกค้าจ่าย)
  useEffect(() => {
    let id: string | undefined;
    try { id = JSON.parse(localStorage.getItem(QR_STORAGE_KEY) ?? "null")?.paymentId; } catch { /* ignore */ }
    if (!id) return;
    (async () => {
      const res = await getQrStatusAction({ paymentId: id });
      if (!res.ok) { try { localStorage.removeItem(QR_STORAGE_KEY); } catch { /* ignore */ } return; }
      const s = res.data;
      if (s.status === "PENDING") { setQrInitial(s); setMethod("qr"); setPayOpen(true); return; }
      try { localStorage.removeItem(QR_STORAGE_KEY); } catch { /* ignore */ }
      if (s.status === "PAID" && s.saleStatus === "COMPLETED") { dispatch({ type: "clear" }); toast.success("ได้รับเงินแล้ว ขายสำเร็จ"); router.push(`/receipt/${s.saleId}`); }
    })();
  }, [router]);

  const getQrKey = useCallback(() => (idemKey.current ??= crypto.randomUUID()), []);
  const renewQrKey = useCallback(() => { idemKey.current = crypto.randomUUID(); }, []);
  const onQrCompleted = useCallback((saleId: string) => {
    dispatch({ type: "clear" });
    setMember(null);
    setPayOpen(false); setQrInitial(null);
    if (saleId) router.push(`/receipt/${saleId}`); else router.refresh();
  }, [router]);

  return (
    <div className="grid gap-4 pb-24 lg:grid-cols-[minmax(0,3fr)_minmax(320px,2fr)] lg:pb-0">
      {/* ซ้าย: ค้นหา + สินค้า */}
      <section className="min-w-0">
        <div className="relative mb-3">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" strokeWidth={1.8} />
          <Input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onSearchEnter(); } }}
            placeholder="สแกนบาร์โค้ด / พิมพ์ SKU หรือชื่อสินค้า"
            aria-label="ค้นหาสินค้า"
            className="pl-11 text-base"
            autoFocus
          />
          {query && (
            <button type="button" onClick={() => { setQuery(""); searchRef.current?.focus(); }} className="absolute right-0 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground hover:bg-lavender-100 hover:text-navy" aria-label="ล้างคำค้น"><X className="size-5" /></button>
          )}
        </div>
        <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
          {[["all", "ทั้งหมด"] as const, ...categories].map(([id, name]) => (
            <button key={id} type="button" onClick={() => setCategoryId(id)}
              className={cn("inline-flex min-h-11 shrink-0 items-center rounded-full border px-4 font-heading text-sm font-semibold transition-colors", categoryId === id ? "border-blue bg-blue text-white" : "border-border bg-card text-navy hover:bg-lavender-100")}>
              {name}
            </button>
          ))}
        </div>
        {filtered.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border-strong bg-card p-10 text-center text-sm text-muted-foreground">ไม่พบสินค้าที่ตรงกับคำค้น</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:max-h-[calc(100vh-17rem)] lg:overflow-y-auto lg:pr-1 xl:grid-cols-4">
            {filtered.map((p) => {
              const inCart = qtyOf(p.id);
              const out = p.sellable <= 0;
              return (
                <button key={p.id} type="button" onClick={() => add(p)} disabled={out}
                  className={cn("relative flex flex-col items-start gap-1 rounded-xl border bg-card p-4 text-left transition hover:border-blue hover:shadow-float disabled:cursor-not-allowed disabled:opacity-50", inCart > 0 && "border-blue ring-2 ring-blue/30")}>
                  {inCart > 0 && <span className="absolute right-2 top-2 rounded-full bg-blue px-2.5 font-heading text-sm font-semibold text-white">{inCart}</span>}
                  <span className="line-clamp-2 min-h-11 pr-6 text-sm font-semibold leading-5 text-navy">{p.name}</span>
                  <span className="font-mono text-sm text-muted-foreground">{p.sku}</span>
                  <span className="mt-1 font-heading text-lg font-bold text-navy tabular-nums">{formatMoney(p.price)}</span>
                  <span className={cn("text-sm", out ? "text-danger" : p.sellable <= 5 ? "text-warning" : "text-muted-foreground")}>{out ? "หมด" : `เหลือ ${p.sellable} ${p.unit}`}</span>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* ขวา: ตะกร้า */}
      <aside
        className={cn(
          "flex-col border bg-card lg:sticky lg:top-[4.5rem] lg:flex lg:max-h-[calc(100vh-9rem)] lg:rounded-xl",
          cartOpen ? "fixed inset-0 z-40 flex" : "hidden",
        )}
        aria-label="ตะกร้าสินค้า"
      >
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="flex items-center gap-2 font-heading text-lg font-semibold"><ShoppingCart className="size-5" strokeWidth={1.8} /> ตะกร้า <span className="text-sm font-normal text-muted-foreground">({lines.length} รายการ / {itemCount} ชิ้น)</span></h2>
          <div className="flex items-center gap-1">
            {lines.length > 0 && <Button variant="ghost" size="sm" onClick={() => setClearOpen(true)}><Trash2 /> ล้าง</Button>}
            <Button variant="outline" size="sm" className="lg:hidden" onClick={() => setCartOpen(false)}><X /> ปิด</Button>
          </div>
        </div>
        <div className="border-b p-3"><MemberPicker value={member} onChange={setMember} /></div>
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
                    <div className="min-w-0"><p className="truncate text-sm font-medium">{p.name}</p><p className="text-sm text-muted-foreground">{formatMoney(p.price)} / {p.unit}</p>{quoteLine(p.id)?.promotionName && <p className="mt-0.5 flex items-center gap-1 text-sm text-success"><Tag className="size-3" /> {quoteLine(p.id)!.promotionName}</p>}</div>
                    <button type="button" onClick={() => dispatch({ type: "remove", productId: p.id })} className="flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-danger-soft hover:text-danger" aria-label={`ลบ ${p.name}`}><X className="size-5" /></button>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1">
                      <Button size="icon-sm" variant="outline" onClick={() => setQty(p, qty - 1)} aria-label="ลดจำนวน"><Minus /></Button>
                      <Input
                        value={qty}
                        inputMode="numeric"
                        aria-label={`จำนวน ${p.name}`}
                        className="w-16 px-1 text-center tabular-nums"
                        onChange={(e) => { const n = parseInt(e.target.value.replace(/\D/g, ""), 10); if (!Number.isNaN(n)) setQty(p, n); }}
                      />
                      <Button size="icon-sm" variant="outline" onClick={() => setQty(p, qty + 1)} aria-label="เพิ่มจำนวน"><Plus /></Button>
                    </div>
                    <span className="text-right tabular-nums">{Number(quoteLine(p.id)?.discount ?? 0) > 0 ? (<><span className="mr-1 text-sm text-muted-foreground line-through">{baht(satang(p.price) * qty)}</span><span className="font-medium">{formatMoney(quoteLine(p.id)!.lineTotal === quoteLine(p.id)!.net ? quoteLine(p.id)!.net : (Number(quoteLine(p.id)!.lineTotal) - Number(quoteLine(p.id)!.discount)).toFixed(2))}</span></>) : <span className="font-medium">{baht(satang(p.price) * qty)}</span>}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="space-y-3 border-t p-4">
          <div className="flex items-baseline justify-between"><span className="text-sm text-muted-foreground">ยอดรวม</span><span className="tabular-nums">{quoteReady ? formatMoney(q!.data!.subtotal) : baht(grossSatang)}</span></div>
          {quoteReady && Number(q!.data!.itemDiscount) > 0 && (
            <div className="flex items-baseline justify-between text-sm text-success"><span>ส่วนลดรายการ</span><span className="tabular-nums">-{formatMoney(q!.data!.itemDiscount)}</span></div>
          )}
          {quoteReady && Number(q!.data!.billDiscount) > 0 && (
            <div className="flex items-baseline justify-between text-sm text-success"><span className="truncate pr-2">{q!.data!.billPromotionName ?? "ส่วนลดทั้งบิล"}</span><span className="tabular-nums">-{formatMoney(q!.data!.billDiscount)}</span></div>
          )}
          <div className="flex items-baseline justify-between"><span className="font-semibold">ยอดสุทธิ</span><span className="font-heading text-page font-bold text-navy tabular-nums">{lines.length && !quoteReady ? "…" : baht(totalSatang)}</span></div>
          {quoteReady && member && q!.data!.points > 0 && <p className="flex items-center gap-1 text-sm text-success"><Star className="size-3" /> สมาชิกจะได้ {q!.data!.points} แต้มจากบิลนี้</p>}
          {q?.error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm font-medium text-danger">{q.error}</p>}
          <Button size="lg" className="w-full" disabled={!lines.length || !quoteReady} onClick={openPay}>{lines.length && !quoteReady && !q?.error ? <><Loader2 className="animate-spin" /> กำลังคำนวณราคา</> : "ชำระเงิน"}</Button>
          <p className="text-center text-sm text-muted-foreground">ราคาและโปรโมชั่นคำนวณโดยเซิร์ฟเวอร์ และคำนวณซ้ำอีกครั้งตอนยืนยัน</p>
        </div>
      </aside>

      {/* แถบสรุปตะกร้า (จอเล็ก) */}
      <div className="fixed inset-x-0 bottom-0 z-30 flex items-center md:left-16 justify-between gap-3 border-t bg-card px-4 py-3 shadow-float lg:hidden">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">{lines.length} รายการ / {itemCount} ชิ้น</p>
          <p className="truncate font-heading text-xl font-bold text-navy tabular-nums">{lines.length && !quoteReady ? "…" : baht(totalSatang)}</p>
        </div>
        <Button size="lg" className="shrink-0 px-5" onClick={() => setCartOpen(true)}><ShoppingCart /> ดูตะกร้า</Button>
      </div>

      {/* ชำระเงิน */}
      <Dialog open={payOpen} onOpenChange={(o) => { if (!pending && !qrLocked) setPayOpen(o); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{method === "cash" ? "ชำระเงินสด" : "ชำระด้วย PromptPay QR"}</DialogTitle>
            <DialogDescription>{lines.length} รายการ / {itemCount} ชิ้น</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-2" role="tablist" aria-label="วิธีชำระเงิน">
            <Button type="button" role="tab" aria-selected={method === "cash"} variant={method === "cash" ? "default" : "outline"} disabled={qrLocked || pending} onClick={() => setMethod("cash")}><Banknote /> เงินสด</Button>
            <Button type="button" role="tab" aria-selected={method === "qr"} variant={method === "qr" ? "default" : "outline"} disabled={qrLocked || pending || !payment.enabled} title={payment.enabled ? undefined : payment.reason} onClick={() => setMethod("qr")}><QrCode /> PromptPay QR</Button>
          </div>
          {!payment.enabled && <p className="text-sm text-muted-foreground">QR ยังใช้ไม่ได้: {payment.reason}</p>}

          {method === "qr" && payment.enabled ? (
            <QrPanel
              key={qrInitial?.paymentId ?? "new"}
              items={lines.map((l) => ({ productId: l.productId, quantity: l.qty }))}
              memberId={member?.id ?? null}
              expectedTotal={q?.data?.total ?? null}
              totalLabel={baht(totalSatang)}
              initial={qrInitial}
              getKey={getQrKey}
              renewKey={renewQrKey}
              onCompleted={onQrCompleted}
              onLockChange={setQrLocked}
            />
          ) : (
            <form onSubmit={(e) => { e.preventDefault(); confirmPay(); }} className="space-y-4">
              <div className="relative overflow-hidden rounded-xl bg-navy-gradient p-5 text-center text-white">
                <span aria-hidden className="pointer-events-none absolute -right-8 -top-8 size-28 rounded-full bg-lavender/20" />
                <p className="relative text-sm text-lavender">ยอดที่ต้องชำระ</p>
                <p className="relative font-heading text-display font-bold tabular-nums">{baht(totalSatang)}</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="paid">รับเงินมา (บาท)</Label>
                <Input id="paid" value={paid} onChange={(e) => setPaid(e.target.value)} inputMode="none" autoFocus autoComplete="off" className="h-11 text-lg tabular-nums" aria-invalid={paid !== "" && paidSatang === null} />
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => setPaid((totalSatang / 100).toFixed(2))}>พอดี</Button>
                  {[100, 500, 1000].map((v) => <Button key={v} type="button" variant="outline" size="sm" onClick={() => setPaid(String(v))}>฿{v.toLocaleString("th-TH")}</Button>)}
                  <Button type="button" variant="outline" size="sm" onClick={() => setPaid("")}>ล้าง</Button>
                </div>
                <div className="grid grid-cols-3 gap-2" role="group" aria-label="แป้นตัวเลข">
                  {["7", "8", "9", "4", "5", "6", "1", "2", "3", ".", "0", "back"].map((k) => (
                    <Button key={k} type="button" variant="outline" className="h-12 text-xl tabular-nums" onClick={() => pressKey(k)} aria-label={k === "back" ? "ลบตัวสุดท้าย" : k === "." ? "จุดทศนิยม" : k}>
                      {k === "back" ? <Delete className="size-5" /> : k}
                    </Button>
                  ))}
                </div>
              </div>
              <div className={cn("flex items-baseline justify-between rounded-xl border p-3", enough ? "border-success/30 bg-success-soft" : "bg-lavender-50")}>
                <span className="text-sm">{paidSatang === null ? "เงินทอน" : enough ? "เงินทอน" : "ยังขาด"}</span>
                <span className={cn("font-heading text-xl font-bold tabular-nums", enough ? "text-success" : "text-danger")}>
                  {paidSatang === null ? "-" : baht(Math.abs(paidSatang - totalSatang))}
                </span>
              </div>
              {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm font-medium text-danger">{error}</p>}
              <DialogFooter>
                <Button type="button" variant="outline" disabled={pending} onClick={() => setPayOpen(false)}>ยกเลิก</Button>
                <Button type="submit" disabled={!enough || pending} className="min-w-32">{pending && <Loader2 className="animate-spin" />} ยืนยันการขาย</Button>
              </DialogFooter>
            </form>
          )}
          {method === "qr" && !qrLocked && (
            <DialogFooter><Button type="button" variant="outline" onClick={() => setPayOpen(false)}>ปิด</Button></DialogFooter>
          )}
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
