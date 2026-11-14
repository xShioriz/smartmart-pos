"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Bell, Boxes, IdCard, ScrollText, LayoutDashboard, Package, Percent, Settings, ShoppingCart, Tags, Users, Receipt, Vault } from "lucide-react";
import type { Role } from "@prisma/client";
import { cn } from "@/lib/utils";
import { BrandLogo } from "./brand-logo";

export type Item = { href: string; label: string; icon: React.ComponentType<{ className?: string; strokeWidth?: number }>; roles: Role[]; ready: boolean };

// ready=false → แสดงเป็น "เร็ว ๆ นี้" (ยังไม่พัฒนา) แก้เป็น true เมื่อหน้าใช้งานได้จริงเท่านั้น
export const NAV_ITEMS: Item[] = [
  { href: "/dashboard", label: "แดชบอร์ด", icon: LayoutDashboard, roles: ["ADMIN"], ready: true },
  { href: "/pos", label: "ขายหน้าร้าน (POS)", icon: ShoppingCart, roles: ["ADMIN", "CASHIER"], ready: true },
  { href: "/products", label: "สินค้า", icon: Package, roles: ["ADMIN"], ready: true },
  { href: "/categories", label: "หมวดหมู่", icon: Tags, roles: ["ADMIN"], ready: true },
  { href: "/promotions", label: "โปรโมชั่น", icon: Percent, roles: ["ADMIN"], ready: true },
  { href: "/members", label: "สมาชิก", icon: IdCard, roles: ["ADMIN"], ready: true },
  { href: "/notifications", label: "การแจ้งเตือน", icon: Bell, roles: ["ADMIN"], ready: true },
  { href: "/inventory", label: "คลังสินค้า", icon: Boxes, roles: ["ADMIN", "CASHIER"], ready: true },
  { href: "/sales", label: "ประวัติการขาย", icon: Receipt, roles: ["ADMIN", "CASHIER"], ready: true },
  { href: "/shifts", label: "ปิดกะ / นับเงินสด", icon: Vault, roles: ["ADMIN", "CASHIER"], ready: true },
  { href: "/reports", label: "รายงาน", icon: BarChart3, roles: ["ADMIN"], ready: true },
  { href: "/users", label: "ผู้ใช้งาน", icon: Users, roles: ["ADMIN"], ready: true },
  { href: "/audit", label: "บันทึกการใช้งาน", icon: ScrollText, roles: ["ADMIN"], ready: true },
  { href: "/settings", label: "ตั้งค่า", icon: Settings, roles: ["ADMIN"], ready: true },
];

/** แถบข้าง (DESIGN.md §4): พื้น navy gradient, รายการที่เลือกพื้น blue ตัวอักษรขาว, ไอคอนเส้นบาง 1.8 */
export function Sidebar({ role }: { role: Role }) {
  const pathname = usePathname();
  return (
    <aside className="sticky top-0 hidden h-screen w-16 shrink-0 flex-col bg-navy-gradient text-sidebar-foreground md:flex xl:w-64">
      <div className="flex h-16 items-center border-b border-sidebar-border px-3 xl:px-4">
        <BrandLogo className="xl:hidden" iconOnly />
        <BrandLogo className="hidden xl:inline-flex" />
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto p-2" aria-label="เมนูหลัก">
        {NAV_ITEMS.filter((i) => i.roles.includes(role)).map(({ href, label, icon: Icon, ready }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          const base = "flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-blue-soft";
          if (!ready) {
            return (
              <div key={href} title={`${label} (เร็ว ๆ นี้)`} className={cn(base, "cursor-not-allowed text-white/50")}>
                <Icon className="size-5 shrink-0" strokeWidth={1.8} />
                <span className="hidden flex-1 xl:inline">{label}</span>
                <span className="hidden rounded bg-white/10 px-1.5 py-0.5 text-xs xl:inline">เร็ว ๆ นี้</span>
              </div>
            );
          }
          return (
            <Link key={href} href={href} title={label} aria-current={active ? "page" : undefined} className={cn(base, active ? "bg-blue font-semibold text-white" : "text-white/85 hover:bg-white/10 hover:text-white")}>
              <Icon className="size-5 shrink-0" strokeWidth={1.8} />
              <span className="hidden xl:inline">{label}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
