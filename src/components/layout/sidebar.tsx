"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Bell, Boxes, IdCard, ScrollText, LayoutDashboard, Package, Percent, Settings, ShoppingBasket, ShoppingCart, Tags, Users, Receipt, Vault } from "lucide-react";
import type { Role } from "@prisma/client";
import { cn } from "@/lib/utils";

export type Item = { href: string; label: string; icon: React.ComponentType<{ className?: string }>; roles: Role[]; ready: boolean };

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

export function Sidebar({ role }: { role: Role }) {
  const pathname = usePathname();
  return (
    <aside className="sticky top-0 hidden h-screen w-16 shrink-0 flex-col border-r bg-card md:flex xl:w-60">
      <div className="flex h-14 items-center gap-2 border-b px-4">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <ShoppingBasket className="size-4" />
        </div>
        <span className="hidden font-semibold xl:inline">SmartMart POS</span>
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto p-2">
        {NAV_ITEMS.filter((i) => i.roles.includes(role)).map(({ href, label, icon: Icon, ready }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          const base = "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors";
          if (!ready) {
            return (
              <div key={href} title={`${label} (เร็ว ๆ นี้)`} className={cn(base, "cursor-not-allowed text-muted-foreground/60")}>
                <Icon className="size-4 shrink-0" />
                <span className="hidden flex-1 xl:inline">{label}</span>
                <span className="hidden rounded bg-muted px-1.5 py-0.5 text-[10px] xl:inline">เร็ว ๆ นี้</span>
              </div>
            );
          }
          return (
            <Link key={href} href={href} title={label} className={cn(base, active ? "bg-green-50 font-medium text-green-700" : "text-foreground/80 hover:bg-muted")}>
              <Icon className="size-4 shrink-0" />
              <span className="hidden xl:inline">{label}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
