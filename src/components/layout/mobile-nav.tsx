"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, ShoppingBasket, X } from "lucide-react";
import type { Role } from "@prisma/client";
import { cn } from "@/lib/utils";
import { NAV_ITEMS } from "./sidebar";

/** เมนูลิ้นชักสำหรับจอแคบ (< md) — จอ iPad แนวตั้งขึ้นไปใช้แถบข้างแบบไอคอน */
export function MobileNav({ role }: { role: Role }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden"; // ไม่ให้หน้าเลื่อนอยู่ข้างหลัง
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [open]);

  return (
    <div className="md:hidden">
      <button type="button" onClick={() => setOpen(true)} aria-label="เปิดเมนู" aria-expanded={open} className="flex size-10 items-center justify-center rounded-lg hover:bg-muted">
        <Menu className="size-5" />
      </button>
      {open && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="เมนูหลัก">
          <button type="button" className="absolute inset-0 bg-black/40" aria-label="ปิดเมนู" onClick={() => setOpen(false)} />
          <nav className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-sidebar text-sidebar-foreground shadow-xl">
            <div className="flex h-14 items-center justify-between border-b border-sidebar-border px-4">
              <span className="flex items-center gap-2 font-semibold">
                <span className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground"><ShoppingBasket className="size-4" /></span>
                SmartMart POS
              </span>
              <button type="button" onClick={() => setOpen(false)} aria-label="ปิดเมนู" className="flex size-10 items-center justify-center rounded-lg hover:bg-muted"><X className="size-5" /></button>
            </div>
            <ul className="flex-1 space-y-1 overflow-y-auto p-2">
              {NAV_ITEMS.filter((i) => i.roles.includes(role) && i.ready).map(({ href, label, icon: Icon }) => {
                const active = pathname === href || pathname.startsWith(href + "/");
                return (
                  <li key={href}>
                    <Link href={href} onClick={() => setOpen(false)} aria-current={active ? "page" : undefined} className={cn("flex min-h-11 items-center gap-3 rounded-md px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/30", active ? "bg-primary/10 font-medium text-primary" : "text-foreground/80 hover:bg-muted")}>
                      <Icon className="size-4 shrink-0" /> {label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        </div>
      )}
    </div>
  );
}
